import { Inject,BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Prisma, SessionStatus } from '@prisma/client';
import { randomBytes } from 'node:crypto';
import { Db } from './db';
import { config } from './config';
import { digest, token,turnCredential } from './crypto';
import { Principal,admin,device } from './security';
import { assertTransition,isTerminal,maySignal,State } from './state';
import { events } from './events';
import { heartbeat,pairingConfirm } from './validation';
import { z } from 'zod';
const openStates:SessionStatus[]=['REQUESTED','WAITING_DEVICE','WAITING_APPROVAL','APPROVED','CONNECTING','ACTIVE','ENDING'];
const defaultSettings={maxSessionMinutes:30,retentionDays:90,maxFileBytes:20971520};
const absent=()=>new NotFoundException({code:'NOT_FOUND',message:'Recurso não encontrado.'});
const invalidState=()=>new ConflictException({code:'INVALID_SESSION_STATE',message:'A sessão não permite esta ação.'});
export function deviceView(d:any){return {id:d.id,name:d.name,manufacturer:d.manufacturer,model:d.model,androidVersion:d.androidVersion,appVersion:d.appVersion,battery:d.battery,charging:d.charging,network:d.network,permissions:d.permissions,lastSeenAt:d.lastSeenAt,createdAt:d.createdAt,revokedAt:d.revokedAt,online:!d.revokedAt&&!!d.lastSeenAt&&d.lastSeenAt.getTime()>Date.now()-30_000};}
export function sessionView(s:any){return {id:s.id,deviceId:s.deviceId,operatorId:s.operatorId,operator:s.operator?{id:s.operator.id,email:s.operator.email}:undefined,status:s.status,requestedControl:s.requestedControl,controlApproved:s.controlApproved,createdAt:s.createdAt,expiresAt:s.expiresAt,startedAt:s.startedAt,endedAt:s.endedAt,endReason:s.endReason,device:s.device?deviceView(s.device):undefined,leaseSeconds:10};}
@Injectable()
export class HubService implements OnModuleInit,OnModuleDestroy {
 private timer:ReturnType<typeof setInterval>|undefined;
 constructor(@Inject(Db) readonly db:Db){}
 async onModuleInit(){if(process.env.VERCEL==='1')return;for(const s of await this.db.remoteSession.findMany({where:{status:{in:openStates}}}))await this.terminate(s.id,'ENDED','SERVER_RESTART');this.timer=setInterval(()=>{void this.expireSessions().catch(()=>console.error('Session expiry sweep failed'));},1000);this.timer.unref();}
 onModuleDestroy(){clearInterval(this.timer);}
 async audit(ownerId:string,type:string,fields:{actorId?:string;deviceId?:string;sessionId?:string;details?:Prisma.InputJsonValue}={}){return this.db.auditEvent.create({data:{ownerId,type,...fields}});}
 async settings(ownerId:string){const s=await this.db.systemSettings.findUnique({where:{ownerId}});return s?{maxSessionMinutes:s.maxSessionMinutes,retentionDays:s.retentionDays,maxFileBytes:s.maxFileBytes}:defaultSettings;}
 async getDevice(p:Principal,id:string){const d=await this.db.device.findFirst({where:{id,ownerId:p.userId,...(p.kind==='device'?{id:p.deviceId}:{} )}});if(!d||d.id!==id)throw absent();return d;}
 async listDevices(p:Principal){admin(p);return (await this.db.device.findMany({where:{ownerId:p.userId},orderBy:{createdAt:'desc'}})).map(deviceView);}
 async pair(p:Principal){admin(p);const count=await this.db.device.count({where:{ownerId:p.userId,revokedAt:null}});if(count>=100)throw new ConflictException({code:'DEVICE_LIMIT',message:'Limite de aparelhos atingido.'});
  const alphabet='ABCDEFGHJKLMNPQRSTUVWXYZ23456789';const code=Array.from(randomBytes(12),b=>alphabet[b%alphabet.length]).join('');
  const pair=await this.db.pairingRequest.create({data:{ownerId:p.userId,codeHash:digest(code),expiresAt:new Date(Date.now()+5*60_000)}});await this.audit(p.userId,'PAIRING_CREATED',{actorId:p.userId});return {id:pair.id,code,expiresAt:pair.expiresAt};
 }
 async confirmPair(input:z.infer<typeof pairingConfirm>){
  const raw=token(),pair=await this.db.pairingRequest.findUnique({where:{codeHash:digest(input.code)}});if(!pair)throw new BadRequestException({code:'INVALID_PAIRING',message:'Código inválido, utilizado ou expirado.'});
  const registered=await this.db.$transaction(async tx=>{
   await tx.$queryRaw`SELECT id FROM users WHERE id=${pair.ownerId}::uuid FOR UPDATE`;
   const pending=await tx.pairingRequest.findUnique({where:{id:pair.id}});if(!pending||pending.consumedAt||pending.revokedAt||pending.expiresAt.getTime()<=Date.now())throw new BadRequestException({code:'INVALID_PAIRING',message:'Código inválido, utilizado ou expirado.'});
   if(await tx.device.count({where:{ownerId:pair.ownerId,revokedAt:null}})>=100)throw new ConflictException({code:'DEVICE_LIMIT',message:'Limite de aparelhos atingido.'});
   const d=await tx.device.create({data:{ownerId:pair.ownerId,name:input.name,manufacturer:input.manufacturer,model:input.model,androidVersion:input.androidVersion,appVersion:input.appVersion,publicKey:input.publicKey??null,lastSeenAt:new Date(),credentials:{create:{tokenHash:digest(raw),expiresAt:new Date(Date.now()+config.DEVICE_CREDENTIAL_DAYS*86400_000)}}}});
   await tx.pairingRequest.update({where:{id:pair.id},data:{consumedAt:new Date(),deviceId:d.id}});await tx.auditEvent.create({data:{ownerId:pair.ownerId,deviceId:d.id,type:'DEVICE_PAIRED'}});return d;
  });return {device:deviceView(registered),token:raw,expiresAt:new Date(Date.now()+config.DEVICE_CREDENTIAL_DAYS*86400_000)};
 }
 async revokePair(p:Principal,id:string){admin(p);const updated=await this.db.pairingRequest.updateMany({where:{id,ownerId:p.userId,consumedAt:null,revokedAt:null},data:{revokedAt:new Date()}});if(!updated.count)throw absent();await this.audit(p.userId,'PAIRING_REVOKED',{actorId:p.userId});return {ok:true};}
 async revokeDevice(p:Principal,id:string){const d=await this.getDevice(p,id);const sessions=await this.db.$transaction(async tx=>{
  await tx.device.update({where:{id:d.id},data:{revokedAt:new Date()}});await tx.deviceCredential.updateMany({where:{deviceId:d.id,revokedAt:null},data:{revokedAt:new Date()}});
  const active=await tx.remoteSession.findMany({where:{deviceId:d.id,status:{in:openStates}}});
  await tx.remoteSession.updateMany({where:{id:{in:active.map(s=>s.id)}},data:{status:'ENDED',endedAt:new Date(),controlApproved:false,endReason:'DEVICE_REVOKED'}});
  await tx.sessionPermission.updateMany({where:{sessionId:{in:active.map(s=>s.id)},revokedAt:null},data:{revokedAt:new Date()}});
  await tx.auditEvent.create({data:{ownerId:d.ownerId,actorId:p.kind==='admin'?p.userId:undefined,deviceId:d.id,type:'DEVICE_REVOKED'}});return active;
 });for(const s of sessions)events.emit('session-change',s.id);events.emit('device-revoked',d.id);return {ok:true};}
 async rotateDevice(p:Principal){const d=device(p),raw=token();await this.db.$transaction(async tx=>{await tx.deviceCredential.updateMany({where:{deviceId:d.deviceId,revokedAt:null},data:{revokedAt:new Date()}});await tx.deviceCredential.create({data:{deviceId:d.deviceId,tokenHash:digest(raw),expiresAt:new Date(Date.now()+config.DEVICE_CREDENTIAL_DAYS*86400_000)}});await tx.auditEvent.create({data:{ownerId:d.userId,deviceId:d.deviceId,type:'DEVICE_CREDENTIAL_ROTATED'}});});return {token:raw,expiresAt:new Date(Date.now()+config.DEVICE_CREDENTIAL_DAYS*86400_000)};}
 async heartbeat(p:Principal,input:z.infer<typeof heartbeat>){const d=device(p);await this.db.device.update({where:{id:d.deviceId},data:{...input,lastSeenAt:new Date()}});
  await this.db.remoteSession.updateMany({where:{deviceId:d.deviceId,status:'WAITING_DEVICE',approvalExpiresAt:{gt:new Date()}},data:{status:'WAITING_APPROVAL'}});
  return {deviceId:d.deviceId,serverTime:new Date(),leaseSeconds:10};
 }
 async deviceRequests(p:Principal){const d=device(p);await this.expireSessions();return (await this.db.remoteSession.findMany({where:{deviceId:d.deviceId,status:{in:openStates}},include:{device:true,operator:{select:{id:true,email:true}}},orderBy:{createdAt:'desc'}})).map(sessionView);}
 async createSession(p:Principal,deviceId:string,requestedControl:boolean){const a=admin(p),settings=await this.settings(a.userId);const s=await this.db.$transaction(async tx=>{
  await tx.$queryRaw`SELECT id FROM admin_sessions WHERE id=${a.adminSessionId}::uuid FOR UPDATE`;
  const actor=await tx.adminSession.findUnique({where:{id:a.adminSessionId}});if(!actor||actor.revokedAt||actor.expiresAt.getTime()<=Date.now())throw new ForbiddenException();
  await tx.$queryRaw`SELECT id FROM devices WHERE id=${deviceId}::uuid FOR UPDATE`;
  const d=await tx.device.findFirst({where:{id:deviceId,ownerId:a.userId,revokedAt:null}});if(!d)throw absent();
  const active=await tx.remoteSession.findFirst({where:{deviceId,status:{in:openStates},expiresAt:{gt:new Date()}}});if(active)throw new ConflictException({code:'SESSION_EXISTS',message:'Já existe uma solicitação ou sessão ativa neste aparelho.'});
  const created=await tx.remoteSession.create({data:{deviceId,operatorId:a.userId,adminSessionId:a.adminSessionId,requestedControl,status:deviceView(d).online?'WAITING_APPROVAL':'WAITING_DEVICE',approvalExpiresAt:new Date(Date.now()+120_000),expiresAt:new Date(Date.now()+settings.maxSessionMinutes*60_000)},include:{device:true,operator:{select:{id:true,email:true}}}});
  await tx.auditEvent.create({data:{ownerId:a.userId,actorId:a.userId,deviceId,sessionId:created.id,type:'SESSION_REQUESTED',details:{requestedControl}}});return created;
 });events.emit('session-change',s.id);events.emit('session-requested',s.id);return sessionView(s);}
 async getSession(p:Principal,id:string){
  const s=await this.db.remoteSession.findFirst({where:{id,operatorId:p.userId,...(p.kind==='device'?{deviceId:p.deviceId}:{})},include:{device:true,operator:{select:{id:true,email:true}}}});if(!s)throw absent();
  if(p.kind==='device')await this.db.device.update({where:{id:p.deviceId},data:{lastSeenAt:new Date()}});
  if(!isTerminal(s.status)){
   if(!s.device){await this.terminate(s.id,'ENDED','AUTHORIZATION_UNAVAILABLE');throw new ForbiddenException({code:'AUTHORIZATION_UNAVAILABLE',message:'Não foi possível validar a autorização do aparelho.'});}
   const actorSession=await this.db.adminSession.findUnique({where:{id:s.adminSessionId}});
   const expired=s.expiresAt.getTime()<=Date.now()||(['REQUESTED','WAITING_DEVICE','WAITING_APPROVAL'].includes(s.status)&&s.approvalExpiresAt.getTime()<=Date.now());
   const invalid=s.device.revokedAt||!actorSession||actorSession.revokedAt||actorSession.expiresAt.getTime()<=Date.now();
   if(expired||invalid){await this.terminate(s.id,expired?'EXPIRED':'ENDED',expired?'TIMEOUT':'AUTHORIZATION_REVOKED');return this.db.remoteSession.findUniqueOrThrow({where:{id},include:{device:true,operator:{select:{id:true,email:true}}}});}
  }
  return s;
 }
 async listSessions(p:Principal){admin(p);await this.expireSessions();return (await this.db.remoteSession.findMany({where:{operatorId:p.userId},include:{device:true,operator:{select:{id:true,email:true}}},orderBy:{createdAt:'desc'},take:100})).map(sessionView);}
 async transition(p:Principal,id:string,target:SessionStatus,control=false){
  const s=await this.getSession(p,id);if(target==='APPROVED'||target==='REJECTED'||target==='ACTIVE')device(p);
  if(p.kind==='admin'&&s.adminSessionId!==p.adminSessionId)throw new ForbiddenException({code:'OPERATOR_SESSION_MISMATCH',message:'Esta sessão pertence a outro acesso administrativo.'});
  try{assertTransition(s.status as State,target as State);}catch{throw invalidState();}
  if(target==='APPROVED'&&control&&!s.requestedControl)throw new BadRequestException({code:'CONTROL_NOT_REQUESTED',message:'Controle não foi solicitado.'});
  const settings=await this.settings(p.userId);
  const updated=await this.db.$transaction(async tx=>{
   const changed=await tx.remoteSession.updateMany({where:{id,status:s.status},data:{status:target,...(target==='APPROVED'?{controlApproved:control,expiresAt:new Date(Date.now()+settings.maxSessionMinutes*60_000)}:{}),...(target==='ACTIVE'?{startedAt:new Date()}:{}),...(isTerminal(target)?{endedAt:new Date(),controlApproved:false,endReason:target}:{})}});if(changed.count!==1)throw invalidState();
   if(target==='APPROVED'){await tx.sessionPermission.create({data:{sessionId:id,kind:'VIEW'}});if(control)await tx.sessionPermission.create({data:{sessionId:id,kind:'CONTROL'}});}
   if(isTerminal(target))await tx.sessionPermission.updateMany({where:{sessionId:id,revokedAt:null},data:{revokedAt:new Date()}});
   await tx.auditEvent.create({data:{ownerId:p.userId,actorId:p.kind==='admin'?p.userId:undefined,deviceId:s.deviceId,sessionId:id,type:`SESSION_${target}`,details:{controlApproved:target==='APPROVED'?control:false}}});return tx.remoteSession.findUniqueOrThrow({where:{id},include:{device:true,operator:{select:{id:true,email:true}}}});
  });events.emit('session-change',id);return sessionView(updated);
 }
 async terminate(id:string,target:'ENDED'|'EXPIRED'|'FAILED',reason:string){const s=await this.db.remoteSession.findUnique({where:{id}});if(!s||isTerminal(s.status))return;
  await this.db.$transaction(async tx=>{
   const changed=await tx.remoteSession.updateMany({where:{id,status:s.status},data:{status:target,endedAt:new Date(),controlApproved:false,endReason:reason.slice(0,100)}});if(!changed.count)return;
   await tx.sessionPermission.updateMany({where:{sessionId:id,revokedAt:null},data:{revokedAt:new Date()}});await tx.auditEvent.create({data:{ownerId:s.operatorId,deviceId:s.deviceId,sessionId:id,type:`SESSION_${target}`,details:{reason:reason.slice(0,100)}}});
  });events.emit('session-change',id);
 }
 async end(p:Principal,id:string){const s=await this.getSession(p,id);if(p.kind==='admin'&&s.adminSessionId!==p.adminSessionId)throw new ForbiddenException();await this.terminate(id,'ENDED','USER_ENDED');return sessionView(await this.getSession(p,id));}
 async signalAuthorized(p:Principal,id:string){const s=await this.getSession(p,id);if(p.kind==='admin'&&s.adminSessionId!==p.adminSessionId)throw new ForbiddenException();if(!maySignal(s.status,s.expiresAt,!s.device||!!s.device.revokedAt))throw invalidState();return s;}
 async markConnecting(id:string){const changed=await this.db.remoteSession.updateMany({where:{id,status:'APPROVED'},data:{status:'CONNECTING'}});if(changed.count){const s=await this.db.remoteSession.findUniqueOrThrow({where:{id}});await this.audit(s.operatorId,'SESSION_CONNECTING',{deviceId:s.deviceId,sessionId:id});events.emit('session-change',id);}}
 async ice(p:Principal,id:string){const s=await this.signalAuthorized(p,id),expiresAt=Math.min(Math.floor(s.expiresAt.getTime()/1000),Math.floor(Date.now()/1000)+600);const iceServers:Array<{urls:string[];username?:string;credential?:string}>=[];
  const stun=config.STUN_URLS.split(',').filter(Boolean);iceServers.push({urls:stun.length?stun:['stun:stun.l.google.com:19302','stun:stun1.l.google.com:19302']});const turns=config.TURN_URLS.split(',').filter(Boolean);
  if(config.TURN_SECRET&&turns.length){const username=`${expiresAt}:${s.id}`;iceServers.push({urls:turns,username,credential:turnCredential(config.TURN_SECRET,username)});}return {iceServers,expiresAt:new Date(expiresAt*1000)};
 }
 async control(p:Principal,id:string,action:'request'|'approve'|'revoke'){
  const s=await this.getSession(p,id);if(s.status!=='ACTIVE')throw invalidState();if(action==='request')admin(p);else device(p);
  if(p.kind==='admin'&&s.adminSessionId!==p.adminSessionId)throw new ForbiddenException();if(action==='approve'&&!s.requestedControl)throw invalidState();
  const updated=await this.db.$transaction(async tx=>{const changed=await tx.remoteSession.updateMany({where:{id,status:'ACTIVE'},data:action==='request'?{requestedControl:true}:{controlApproved:action==='approve'}});if(!changed.count)throw invalidState();if(action==='approve')await tx.sessionPermission.upsert({where:{sessionId_kind:{sessionId:id,kind:'CONTROL'}},update:{grantedAt:new Date(),revokedAt:null},create:{sessionId:id,kind:'CONTROL'}});if(action==='revoke')await tx.sessionPermission.updateMany({where:{sessionId:id,kind:'CONTROL'},data:{revokedAt:new Date()}});await tx.auditEvent.create({data:{ownerId:p.userId,deviceId:s.deviceId,sessionId:id,type:`CONTROL_${action.toUpperCase()}`}});return tx.remoteSession.findUniqueOrThrow({where:{id},include:{device:true,operator:{select:{id:true,email:true}}}});});events.emit('session-change',id);return sessionView(updated);
 }
 async expireSessions(){const sessions=await this.db.remoteSession.findMany({where:{status:{in:openStates}},include:{device:true,operator:{select:{id:true,email:true}}},take:100});for(const s of sessions){
  const pending=['REQUESTED','WAITING_DEVICE','WAITING_APPROVAL'].includes(s.status),expired=s.expiresAt.getTime()<=Date.now()||(pending&&s.approvalExpiresAt.getTime()<=Date.now());
  if(expired){await this.terminate(s.id,'EXPIRED','TIMEOUT');continue;}
  const a=await this.db.adminSession.findUnique({where:{id:s.adminSessionId}});if(!s.device||s.device.revokedAt||!a||a.revokedAt||a.expiresAt.getTime()<=Date.now())await this.terminate(s.id,'ENDED','AUTHORIZATION_REVOKED');
 }}
}

import { Inject,BadRequestException, Body, Controller, Get, Injectable, Param, Post, Req, Res, UnauthorizedException, UseGuards } from '@nestjs/common';
import type { Response,Request } from 'express';
import * as argon2 from 'argon2';
import { randomBytes } from 'node:crypto';
import { z } from 'zod';
import { Db } from './db';
import { config,cookieName,secureCookie } from './config';
import { base32,csrfFor,decrypt,digest,encrypt,token,verifyTotp } from './crypto';
import { admin,AuthGuard,AuthedRequest,originAllowed } from './security';
import { login,parse,password,uuid } from './validation';
import { events } from './events';
export const hashPassword=(value:string)=>argon2.hash(value,{type:argon2.argon2id,memoryCost:65536,timeCost:3,parallelism:1});
const authError=()=>new UnauthorizedException({code:'INVALID_CREDENTIALS',message:'Credenciais inválidas ou acesso temporariamente limitado.'});
const userView=(u:{id:string;email:string;mfaEnabled:boolean})=>({id:u.id,email:u.email,mfaEnabled:u.mfaEnabled});
@Injectable()
export class AuthService {
 private dummyHash:Promise<string>=hashPassword(token());
 constructor(@Inject(Db) private readonly db:Db){}
 async login(input:z.infer<typeof login>,userAgent:string){
  const user=await this.db.user.findUnique({where:{email:input.email}});
  const valid=await argon2.verify(user?.passwordHash??await this.dummyHash,input.password).catch(()=>false);
  if(!user||!valid||(user.lockedUntil&&user.lockedUntil.getTime()>Date.now())){
   if(user){const count=user.failedLoginCount+1;await this.db.user.update({where:{id:user.id},data:{failedLoginCount:count,lockedUntil:count>=5?new Date(Date.now()+15*60_000):user.lockedUntil}});await this.audit(user.id,'AUTH_LOGIN_FAILED');}
   throw authError();
  }
  if(user.mfaEnabled){
   if(!input.totp)throw new UnauthorizedException({code:'MFA_REQUIRED',message:'Informe o código do autenticador.'});
   const step=user.mfaSecret?verifyTotp(decrypt(user.mfaSecret,Buffer.from(config.MASTER_KEY,'base64')),input.totp,user.mfaLastStep):null;
   if(step===null){await this.db.user.update({where:{id:user.id},data:{failedLoginCount:{increment:1},lockedUntil:user.failedLoginCount>=4?new Date(Date.now()+15*60_000):null}});await this.audit(user.id,'AUTH_MFA_FAILED');throw authError();}
   const changed=await this.db.user.updateMany({where:{id:user.id,mfaLastStep:user.mfaLastStep},data:{mfaLastStep:BigInt(step)}});if(changed.count!==1)throw authError();
  }
  const raw=token(),csrfToken=csrfFor(raw,Buffer.from(config.MASTER_KEY,'base64'));
  const session=await this.db.$transaction(async tx=>{
   await tx.user.update({where:{id:user.id},data:{failedLoginCount:0,lockedUntil:null}});
   const created=await tx.adminSession.create({data:{userId:user.id,tokenHash:digest(raw),csrfHash:digest(csrfToken),userAgent:userAgent.slice(0,300),expiresAt:new Date(Date.now()+config.ADMIN_SESSION_HOURS*3600_000)}});
   await tx.auditEvent.create({data:{ownerId:user.id,actorId:user.id,type:'AUTH_LOGIN'}});return created;
  });
  return {raw,user:userView(user),csrfToken,expiresAt:session.expiresAt};
 }
 private audit(ownerId:string,type:string){return this.db.auditEvent.create({data:{ownerId,actorId:ownerId,type}});}
 async revokeAdmin(ownerId:string,id:string){
  const target=await this.db.adminSession.findFirst({where:{id,userId:ownerId}});if(!target)throw new BadRequestException({code:'NOT_FOUND',message:'Sessão não encontrada.'});
  const ids=await this.db.$transaction(async tx=>{
   await tx.adminSession.update({where:{id},data:{revokedAt:new Date()}});
   const sessions=await tx.remoteSession.findMany({where:{adminSessionId:id,status:{notIn:['ENDED','REJECTED','EXPIRED','FAILED']}}});
   await tx.remoteSession.updateMany({where:{id:{in:sessions.map(s=>s.id)}},data:{status:'ENDED',endedAt:new Date(),controlApproved:false,endReason:'ADMIN_SESSION_REVOKED'}});
   await tx.sessionPermission.updateMany({where:{sessionId:{in:sessions.map(s=>s.id)},revokedAt:null},data:{revokedAt:new Date()}});
   await tx.auditEvent.create({data:{ownerId,actorId:ownerId,type:'ADMIN_SESSION_REVOKED',details:{adminSessionId:id}}});return sessions.map(s=>s.id);
  });for(const sessionId of ids)events.emit('session-change',sessionId);
 }
 async recovery(email:string,recoveryCode:string,newPassword:string){
  const passwordHash=await hashPassword(newPassword);
  const result=await this.db.$transaction(async tx=>{
   const candidate=await tx.user.findUnique({where:{email}});if(!candidate)throw authError();
   await tx.$queryRaw`SELECT id FROM users WHERE id=${candidate.id}::uuid FOR UPDATE`;
   const u=await tx.user.findUniqueOrThrow({where:{id:candidate.id}});const codeHash=digest(recoveryCode);
   if(!u.recoveryHashes.includes(codeHash))throw authError();
   await tx.user.update({where:{id:u.id},data:{passwordHash,recoveryHashes:u.recoveryHashes.filter(x=>x!==codeHash),mfaEnabled:false,mfaSecret:null,mfaPendingSecret:null,mfaLastStep:null,failedLoginCount:0,lockedUntil:null}});
   await tx.adminSession.updateMany({where:{userId:u.id,revokedAt:null},data:{revokedAt:new Date()}});
   const sessions=await tx.remoteSession.findMany({where:{operatorId:u.id,status:{notIn:['ENDED','REJECTED','EXPIRED','FAILED']}}});
   await tx.remoteSession.updateMany({where:{id:{in:sessions.map(s=>s.id)}},data:{status:'ENDED',controlApproved:false,endedAt:new Date(),endReason:'ACCOUNT_RECOVERY'}});
   await tx.sessionPermission.updateMany({where:{sessionId:{in:sessions.map(s=>s.id)},revokedAt:null},data:{revokedAt:new Date()}});
   await tx.auditEvent.create({data:{ownerId:u.id,actorId:u.id,type:'ACCOUNT_RECOVERED'}});return sessions.map(s=>s.id);
  });for(const id of result)events.emit('session-change',id);return {ok:true};
 }
}
@Controller('auth')
export class AuthController {
 constructor(@Inject(AuthService) private readonly auth:AuthService,@Inject(Db) private readonly db:Db){}
 @Post('login') async login(@Body() body:unknown,@Req() req:Request,@Res({passthrough:true}) res:Response){
  if(req.headers.origin&&!originAllowed(req.headers.origin))throw authError();
  const result=await this.auth.login(parse(login,body),req.headers['user-agent']??'Unknown');
  res.cookie(cookieName,result.raw,{httpOnly:true,secure:secureCookie,sameSite:'strict',path:'/',expires:result.expiresAt});res.setHeader('Cache-Control','no-store');return {user:result.user,csrfToken:result.csrfToken};
 }
 @Post('recovery') async recovery(@Body() body:unknown,@Req() req:Request){
  if(req.headers.origin&&!originAllowed(req.headers.origin))throw authError();
  const input=parse(z.object({email:z.email().transform(v=>v.toLowerCase()),recoveryCode:z.string().min(10).max(128),newPassword:password}).strict(),body);
  return this.auth.recovery(input.email,input.recoveryCode,input.newPassword);
 }
 @UseGuards(AuthGuard) @Get('me') async me(@Req() req:AuthedRequest){const p=admin(req.principal);return {user:userView(await this.db.user.findUniqueOrThrow({where:{id:p.userId}})),csrfToken:p.csrfToken};}
 @UseGuards(AuthGuard) @Post('logout') async logout(@Req() req:AuthedRequest,@Res({passthrough:true}) res:Response){const p=admin(req.principal);await this.auth.revokeAdmin(p.userId,p.adminSessionId);res.clearCookie(cookieName,{httpOnly:true,secure:secureCookie,sameSite:'strict',path:'/'});return {ok:true};}
 @UseGuards(AuthGuard) @Get('admin-sessions') async sessions(@Req() req:AuthedRequest){const p=admin(req.principal);return (await this.db.adminSession.findMany({where:{userId:p.userId,revokedAt:null,expiresAt:{gt:new Date()}},orderBy:{createdAt:'desc'}})).map(s=>({id:s.id,createdAt:s.createdAt,expiresAt:s.expiresAt,userAgent:s.userAgent,current:s.id===p.adminSessionId}));}
 @UseGuards(AuthGuard) @Post('admin-sessions/:id/revoke') async revoke(@Param('id') id:string,@Req() req:AuthedRequest){const p=admin(req.principal);await this.auth.revokeAdmin(p.userId,parse(uuid,id));return {ok:true};}
 @UseGuards(AuthGuard) @Post('password') async changePassword(@Body() body:unknown,@Req() req:AuthedRequest){
  const p=admin(req.principal),input=parse(z.object({currentPassword:z.string().max(128),newPassword:password}).strict(),body);const user=await this.db.user.findUniqueOrThrow({where:{id:p.userId}});
  if(!await argon2.verify(user.passwordHash,input.currentPassword))throw authError();
  await this.db.user.update({where:{id:user.id},data:{passwordHash:await hashPassword(input.newPassword)}});
  for(const s of await this.db.adminSession.findMany({where:{userId:user.id,id:{not:p.adminSessionId},revokedAt:null}}))await this.auth.revokeAdmin(user.id,s.id);
  await this.db.auditEvent.create({data:{ownerId:user.id,actorId:user.id,type:'PASSWORD_CHANGED'}});return {ok:true};
 }
 @UseGuards(AuthGuard) @Post('mfa/setup') async setup(@Req() req:AuthedRequest){
  const p=admin(req.principal),user=await this.db.user.findUniqueOrThrow({where:{id:p.userId}});if(user.mfaEnabled)throw new BadRequestException({code:'MFA_ENABLED',message:'O MFA já está ativo.'});
  const secret=base32(randomBytes(20));await this.db.user.update({where:{id:user.id},data:{mfaPendingSecret:encrypt(secret,Buffer.from(config.MASTER_KEY,'base64'))}});
  return {secret,otpauthUrl:`otpauth://totp/Android%20Remote%20Hub:${encodeURIComponent(user.email)}?secret=${secret}&issuer=Android%20Remote%20Hub&algorithm=SHA1&digits=6&period=30`};
 }
 @UseGuards(AuthGuard) @Post('mfa/enable') async enable(@Body() body:unknown,@Req() req:AuthedRequest){
  const p=admin(req.principal),input=parse(z.object({code:z.string().regex(/^\d{6}$/)}).strict(),body),user=await this.db.user.findUniqueOrThrow({where:{id:p.userId}});
  const step=user.mfaPendingSecret?verifyTotp(decrypt(user.mfaPendingSecret,Buffer.from(config.MASTER_KEY,'base64')),input.code):null;if(step===null||user.mfaEnabled)throw authError();
  const codes=Array.from({length:10},()=>token(18));const changed=await this.db.user.updateMany({where:{id:user.id,mfaEnabled:false,mfaPendingSecret:user.mfaPendingSecret},data:{mfaEnabled:true,mfaSecret:user.mfaPendingSecret,mfaPendingSecret:null,mfaLastStep:BigInt(step),recoveryHashes:codes.map(digest)}});if(changed.count!==1)throw authError();
  await this.db.auditEvent.create({data:{ownerId:user.id,actorId:user.id,type:'MFA_ENABLED'}});return {recoveryCodes:codes};
 }
 @UseGuards(AuthGuard) @Post('mfa/disable') async disable(@Body() body:unknown,@Req() req:AuthedRequest){
  const p=admin(req.principal),input=parse(z.object({code:z.string().regex(/^\d{6}$/)}).strict(),body),user=await this.db.user.findUniqueOrThrow({where:{id:p.userId}});
  const step=user.mfaSecret?verifyTotp(decrypt(user.mfaSecret,Buffer.from(config.MASTER_KEY,'base64')),input.code,user.mfaLastStep):null;if(step===null||!user.mfaEnabled)throw authError();
  const changed=await this.db.user.updateMany({where:{id:user.id,mfaLastStep:user.mfaLastStep},data:{mfaEnabled:false,mfaSecret:null,mfaPendingSecret:null,mfaLastStep:null,recoveryHashes:[]}});if(changed.count!==1)throw authError();await this.db.auditEvent.create({data:{ownerId:user.id,actorId:user.id,type:'MFA_DISABLED'}});return {ok:true};
 }
}

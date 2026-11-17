import { Inject,Body,Controller,Injectable,OnModuleDestroy,OnModuleInit,Post,Req,UseGuards } from '@nestjs/common';
import { readFile } from 'node:fs/promises';
import { createSign } from 'node:crypto';
import { z } from 'zod';
import { config } from './config.js';
import { decrypt,encrypt } from './crypto.js';
import { Db } from './db.js';
import { AuthGuard,AuthedRequest,device } from './security.js';
import { parse } from './validation.js';
import { events } from './events.js';
@Injectable()
export class NotificationsService implements OnModuleInit,OnModuleDestroy {
 private access?:{token:string;expires:number};
 constructor(@Inject(Db) private readonly db:Db){}
 onModuleInit(){events.on('session-requested',this.notify);}
 onModuleDestroy(){events.off('session-requested',this.notify);}
 private notify=(id:string)=>{void this.send(id).catch(async()=>{const s=await this.db.remoteSession.findUnique({where:{id}});if(s)await this.db.auditEvent.create({data:{ownerId:s.operatorId,deviceId:s.deviceId,sessionId:id,type:'PUSH_DELIVERY_FAILED'}}).catch(()=>{});});};
 private async send(id:string){
  const credentialFile=process.env.FCM_SERVICE_ACCOUNT_FILE;if(!credentialFile)return;
  const s=await this.db.remoteSession.findUnique({where:{id},include:{device:true}});if(!s?.device.pushToken)return;
  const serviceAccount=z.object({project_id:z.string(),client_email:z.email(),private_key:z.string().min(1)}).parse(JSON.parse(await readFile(credentialFile,'utf8')));
  if(!this.access||this.access.expires<Date.now()+60000){
   const now=Math.floor(Date.now()/1000),encode=(v:unknown)=>Buffer.from(JSON.stringify(v)).toString('base64url');const header=encode({alg:'RS256',typ:'JWT'}),body=encode({iss:serviceAccount.client_email,scope:'https://www.googleapis.com/auth/firebase.messaging',aud:'https://oauth2.googleapis.com/token',iat:now,exp:now+3600});
   const unsigned=`${header}.${body}`,signature=createSign('RSA-SHA256').update(unsigned).sign(serviceAccount.private_key,'base64url');
   const response=await fetch('https://oauth2.googleapis.com/token',{method:'POST',headers:{'Content-Type':'application/x-www-form-urlencoded'},body:new URLSearchParams({grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer',assertion:`${unsigned}.${signature}`}),signal:AbortSignal.timeout(10000)});if(!response.ok)throw new Error('FCM authorization failed');
   const result=z.object({access_token:z.string(),expires_in:z.number()}).parse(await response.json());this.access={token:result.access_token,expires:Date.now()+result.expires_in*1000};
  }
  const response=await fetch(`https://fcm.googleapis.com/v1/projects/${encodeURIComponent(serviceAccount.project_id)}/messages:send`,{method:'POST',headers:{'Content-Type':'application/json',Authorization:`Bearer ${this.access.token}`},body:JSON.stringify({message:{token:decrypt(s.device.pushToken,Buffer.from(config.MASTER_KEY,'base64')),notification:{title:'Solicitação de assistência',body:`Abra o Android Remote Hub em ${s.device.name} para autorizar ou recusar.`},data:{sessionId:s.id},android:{priority:'HIGH',notification:{channel_id:'requests'}}}}),signal:AbortSignal.timeout(10000)});
  if(!response.ok)throw new Error('FCM send failed');await this.db.auditEvent.create({data:{ownerId:s.operatorId,deviceId:s.deviceId,sessionId:s.id,type:'PUSH_SENT'}});
 }
}
@UseGuards(AuthGuard)
@Controller('device')
export class NotificationsController {
 constructor(@Inject(Db) private readonly db:Db){}
 @Post('push-token') async register(@Body() body:unknown,@Req() req:AuthedRequest){const p=device(req.principal),input=parse(z.object({token:z.string().min(1).max(4096)}).strict(),body);await this.db.device.update({where:{id:p.deviceId},data:{pushToken:encrypt(input.token,Buffer.from(config.MASTER_KEY,'base64'))}});return {ok:true,pushConfigured:!!process.env.FCM_SERVICE_ACCOUNT_FILE};}
}

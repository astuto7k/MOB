import { Inject,CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { Db } from './db.js';
import { config,cookieName } from './config.js';
import { csrfFor,digest,equal } from './crypto.js';
export type Principal={kind:'admin';userId:string;adminSessionId:string;csrfToken:string}|{kind:'device';userId:string;deviceId:string;credentialId:string};
export type AuthedRequest=Request&{principal:Principal};
export function admin(p:Principal){if(p.kind!=='admin')throw new ForbiddenException({code:'ADMIN_REQUIRED',message:'Acesso administrativo necessário.'});return p;}
export function device(p:Principal){if(p.kind!=='device')throw new ForbiddenException({code:'DEVICE_REQUIRED',message:'Credencial do aparelho necessária.'});return p;}
export function originAllowed(origin:unknown){
 if(typeof origin!=='string')return false;
 if(origin===config.WEB_ORIGIN)return true;
 if(config.NODE_ENV!=='production'){
  if(/^http:\/\/(localhost|127\.0\.0\.1|192\.168\.\d{1,3}\.\d{1,3}|10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[0-1])\.\d{1,3}\.\d{1,3}):3000$/.test(origin))return true;
 }
 return false;
}
@Injectable()
export class Security {
 constructor(@Inject(Db) private readonly db:Db){}
 async authenticate(headers:Request['headers'],cookies:Record<string,string>={}):Promise<Principal>{
  const bearer=headers.authorization?.match(/^Bearer ([A-Za-z0-9_-]{32,128})$/)?.[1];
  if(headers.authorization&&!bearer)throw new UnauthorizedException({code:'UNAUTHORIZED',message:'Credencial inválida.'});
  if(bearer){
   const credential=await this.db.deviceCredential.findUnique({where:{tokenHash:digest(bearer)},include:{device:true}});
   if(!credential||credential.revokedAt||credential.expiresAt.getTime()<=Date.now()||!credential.device||credential.device.revokedAt)throw new UnauthorizedException({code:'UNAUTHORIZED',message:'Credencial revogada ou expirada.'});
   return {kind:'device',userId:credential.device.ownerId,deviceId:credential.deviceId,credentialId:credential.id};
  }
  const raw=cookies[cookieName]; if(!raw||!/^[A-Za-z0-9_-]{32,128}$/.test(raw))throw new UnauthorizedException({code:'UNAUTHORIZED',message:'Entre para continuar.'});
  const session=await this.db.adminSession.findUnique({where:{tokenHash:digest(raw)}});
  if(!session||session.revokedAt||session.expiresAt.getTime()<=Date.now())throw new UnauthorizedException({code:'UNAUTHORIZED',message:'Sessão administrativa expirada.'});
  return {kind:'admin',userId:session.userId,adminSessionId:session.id,csrfToken:csrfFor(raw,Buffer.from(config.MASTER_KEY,'base64'))};
 }
}
@Injectable()
export class AuthGuard implements CanActivate {
 constructor(@Inject(Security) private readonly security:Security){}
 async canActivate(context:ExecutionContext){
  const req=context.switchToHttp().getRequest<AuthedRequest>();
  req.principal=await this.security.authenticate(req.headers,req.cookies);
  if(req.principal.kind==='admin'&&!['GET','HEAD','OPTIONS'].includes(req.method)){
   if(!originAllowed(req.headers.origin)||typeof req.headers['x-csrf-token']!=='string'||!equal(req.headers['x-csrf-token'],req.principal.csrfToken))throw new ForbiddenException({code:'CSRF_REJECTED',message:'Atualize a página antes de continuar.'});
  }
  return true;
 }
}

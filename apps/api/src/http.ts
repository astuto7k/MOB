import { ArgumentsHost,Catch,ExceptionFilter,HttpException } from '@nestjs/common';
import type { NextFunction,Request,Response } from 'express';
@Catch()
export class ErrorFilter implements ExceptionFilter {
 catch(error:unknown,host:ArgumentsHost){
  const res=host.switchToHttp().getResponse<Response>();if(res.headersSent)return;
  if(error instanceof HttpException){const body=error.getResponse(),status=error.getStatus();const defaultCode:Record<number,string>={400:'BAD_REQUEST',401:'UNAUTHORIZED',403:'FORBIDDEN',404:'NOT_FOUND',409:'CONFLICT',429:'RATE_LIMITED'};res.status(status).json(typeof body==='object'?{code:defaultCode[status]??'REQUEST_REJECTED',...body}:{code:defaultCode[status]??'REQUEST_REJECTED',message:body});return;}
  if(typeof error==='object'&&error!==null&&'type' in error){const kind=String(error.type);if(kind==='entity.too.large'){res.status(413).json({code:'PAYLOAD_TOO_LARGE',message:'Solicitação excede o limite permitido.'});return;}if(kind==='entity.parse.failed'){res.status(400).json({code:'INVALID_JSON',message:'JSON inválido.'});return;}}
  const code=typeof error==='object'&&error!==null&&'code' in error?String(error.code):'';
  if(code==='P2002'||code==='P2034'){res.status(409).json({code:'CONFLICT',message:'Conflito de atualização. Tente novamente.'});return;}
  if(code==='P2025'){res.status(404).json({code:'NOT_FOUND',message:'Recurso não encontrado.'});return;}
  console.error('Request failed:',error instanceof Error?error.name:'UnknownError');res.status(500).json({code:'INTERNAL_ERROR',message:'O servidor não conseguiu concluir a solicitação.'});
 }
}
export function rateLimit(){
 const buckets=new Map<string,{count:number;until:number}>();
 return(req:Request,res:Response,next:NextFunction)=>{
  if(req.path.endsWith('/health'))return next();
  const sensitive=/\/(auth\/(login|recovery)|pairing\/confirm)$/.test(req.path);
  const key=`${req.ip}:${sensitive?'sensitive':'general'}`,now=Date.now(),window=sensitive?15*60_000:60_000,limit=sensitive?20:1200;
  let bucket=buckets.get(key);if(!bucket||bucket.until<=now){bucket={count:0,until:now+window};buckets.set(key,bucket);}
  if(buckets.size>10000){for(const [k,v] of buckets)if(v.until<=now)buckets.delete(k);if(buckets.size>10000)buckets.delete(buckets.keys().next().value!);}
  if(++bucket.count>limit){res.setHeader('Retry-After',Math.ceil((bucket.until-now)/1000));res.status(429).json({code:'RATE_LIMITED',message:'Muitas tentativas. Aguarde antes de tentar novamente.'});return;}
  res.setHeader('Cache-Control','no-store');next();
 };
}

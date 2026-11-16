import { Inject,Injectable,OnModuleDestroy } from '@nestjs/common';
import type { Server } from 'node:http';
import type { IncomingMessage } from 'node:http';
import { WebSocket,WebSocketServer } from 'ws';
import { Security,Principal,originAllowed } from './security';
import { HubService,sessionView } from './hub';
import { signaling } from './validation';
import { events } from './events';
import { isTerminal } from './state';
type Client={socket:WebSocket;request:IncomingMessage;principal:Principal;sessionId?:string;count:number;window:number;alive:boolean};
function cookies(header:string|undefined){const result:Record<string,string>={};for(const item of (header??'').split(';')){const split=item.indexOf('=');if(split<0)continue;const key=item.slice(0,split).trim();try{result[key]=decodeURIComponent(item.slice(split+1).trim());}catch{}}return result;}
@Injectable()
export class SignalingService implements OnModuleDestroy {
 private server?:WebSocketServer;private clients=new Set<Client>();private timer?:ReturnType<typeof setInterval>;
 constructor(@Inject(Security) private readonly security:Security,@Inject(HubService) private readonly hub:HubService){}
 attach(http:Server){
  this.server=new WebSocketServer({noServer:true,maxPayload:196608,perMessageDeflate:false});
  http.on('upgrade',(req,socket,head)=>{
   if(new URL(req.url??'/', 'http://localhost').pathname!=='/api/v1/signaling'){socket.destroy();return;}
   void(async()=>{try{
    if(this.clients.size>=16)throw new Error('Connection limit');
    const p=await this.security.authenticate(req.headers,cookies(req.headers.cookie));
    if(p.kind==='admin'&&!originAllowed(req.headers.origin))throw new Error('Invalid origin');
    this.server!.handleUpgrade(req,socket,head,ws=>this.connect(ws,req,p));
   }catch{socket.write('HTTP/1.1 401 Unauthorized\r\nConnection: close\r\n\r\n');socket.destroy();}})();
  });
  events.on('session-change',this.onSessionChange);events.on('device-revoked',this.onDeviceRevoke);
  this.timer=setInterval(()=>void this.sweep(),5000);this.timer.unref();
 }
 private send(c:Client,value:unknown){if(c.socket.readyState===WebSocket.OPEN)c.socket.send(JSON.stringify(value));}
 private connect(socket:WebSocket,request:IncomingMessage,principal:Principal){
  const c:Client={socket,request,principal,count:0,window:Date.now(),alive:true};this.clients.add(c);
  socket.on('pong',()=>{c.alive=true;});socket.on('error',()=>socket.close(1011,'Network error'));
  socket.on('message',(raw,isBinary)=>{void this.message(c,raw.toString(),isBinary).catch(()=>{this.send(c,{type:'error',code:'SIGNAL_REJECTED',message:'Sinalização recusada.'});socket.close(1008,'Signal rejected');});});
  socket.on('close',()=>{this.clients.delete(c);if(c.sessionId)void this.hub.terminate(c.sessionId,'ENDED','PEER_DISCONNECTED').catch(()=>{});});
 }
 private async message(c:Client,raw:string,binary:boolean){
  if(binary)throw new Error('JSON required');if(Date.now()-c.window>10000){c.count=0;c.window=Date.now();}if(++c.count>200)throw new Error('Rate limit');
  c.principal=await this.security.authenticate(c.request.headers,cookies(c.request.headers.cookie));const parsed=signaling.safeParse(JSON.parse(raw));if(!parsed.success)throw new Error('Invalid payload');const msg=parsed.data;
  await this.hub.signalAuthorized(c.principal,msg.sessionId);
  if(msg.type==='join'){
   if(c.sessionId&&c.sessionId!==msg.sessionId)throw new Error('One session per socket');
   if([...this.clients].some(peer=>peer!==c&&peer.sessionId===msg.sessionId&&peer.principal.kind===c.principal.kind))throw new Error('Role occupied');
   c.sessionId=msg.sessionId;const peer=[...this.clients].find(peer=>peer!==c&&peer.sessionId===msg.sessionId&&peer.principal.kind!==c.principal.kind);
   this.send(c,{type:'joined',sessionId:msg.sessionId,peerPresent:!!peer});if(peer){await this.hub.markConnecting(msg.sessionId);this.send(peer,{type:'peer-joined',sessionId:msg.sessionId});this.send(peer,{type:'peer-ready',sessionId:msg.sessionId});this.send(c,{type:'peer-ready',sessionId:msg.sessionId});}return;
  }
  if(c.sessionId!==msg.sessionId)throw new Error('Join first');
  if((msg.type==='offer'&&c.principal.kind!=='admin')||(msg.type==='answer'&&c.principal.kind!=='device'))throw new Error('Invalid SDP direction');
  if((msg.type==='offer'||msg.type==='answer')&&msg.payload.type!==msg.type)throw new Error('SDP type mismatch');
  const peer=[...this.clients].find(peer=>peer!==c&&peer.sessionId===msg.sessionId&&peer.principal.kind!==c.principal.kind);if(!peer)throw new Error('Peer not ready');this.send(peer,msg);
 }
 private onSessionChange=(id:string)=>{void(async()=>{const s=await this.hub.db.remoteSession.findUnique({where:{id},include:{device:true,operator:{select:{id:true,email:true}}}});if(!s)return;for(const c of this.clients){if(c.sessionId!==id)continue;this.send(c,{type:'session',sessionId:id,payload:sessionView(s)});if(isTerminal(s.status))c.socket.close(1000,'Session ended');}})().catch(()=>{});};
 private onDeviceRevoke=(id:string)=>{for(const c of this.clients)if(c.principal.kind==='device'&&c.principal.deviceId===id)c.socket.close(1008,'Device revoked');};
 private async sweep(){for(const c of this.clients){try{
  if(!c.alive)throw new Error('Heartbeat timeout');c.alive=false;c.socket.ping();c.principal=await this.security.authenticate(c.request.headers,cookies(c.request.headers.cookie));if(c.sessionId)await this.hub.signalAuthorized(c.principal,c.sessionId);
 }catch{c.socket.close(1008,'Authorization expired');if(c.sessionId)await this.hub.terminate(c.sessionId,'ENDED','SIGNALING_LOST').catch(()=>{});}}}
 onModuleDestroy(){clearInterval(this.timer);events.off('session-change',this.onSessionChange);events.off('device-revoked',this.onDeviceRevoke);for(const c of this.clients)c.socket.close(1001,'Server shutdown');this.server?.close();}
}

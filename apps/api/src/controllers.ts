import { Inject,BadRequestException, Body, Controller, Delete, Get, Param, Patch, Post, Req, UseGuards } from '@nestjs/common';
import { z } from 'zod';
import { Db } from './db';
import { HubService,deviceView,sessionView } from './hub';
import { admin,AuthGuard,AuthedRequest,device } from './security';
import { heartbeat,pairingConfirm,parse,uuid } from './validation';
@UseGuards(AuthGuard)
@Controller('devices')
export class DevicesController {
 constructor(@Inject(HubService) private readonly hub:HubService,@Inject(Db) private readonly db:Db){}
 @Get() list(@Req() req:AuthedRequest){return this.hub.listDevices(req.principal);}
 @Get(':id') async get(@Param('id') id:string,@Req() req:AuthedRequest){admin(req.principal);return deviceView(await this.hub.getDevice(req.principal,parse(uuid,id)));}
 @Patch(':id') async rename(@Param('id') id:string,@Body() body:unknown,@Req() req:AuthedRequest){const p=admin(req.principal),d=await this.hub.getDevice(p,parse(uuid,id)),input=parse(z.object({name:z.string().trim().min(1).max(80)}).strict(),body);const updated=await this.db.device.update({where:{id:d.id},data:input});await this.hub.audit(p.userId,'DEVICE_RENAMED',{actorId:p.userId,deviceId:d.id});return deviceView(updated);}
 @Delete(':id') revoke(@Param('id') id:string,@Req() req:AuthedRequest){admin(req.principal);return this.hub.revokeDevice(req.principal,parse(uuid,id));}
}
@Controller('pairing')
export class PairingController {
 constructor(@Inject(HubService) private readonly hub:HubService){}
 @UseGuards(AuthGuard) @Post() create(@Req() req:AuthedRequest){return this.hub.pair(req.principal);}
 @Post('confirm') confirm(@Body() body:unknown){return this.hub.confirmPair(parse(pairingConfirm,body));}
 @UseGuards(AuthGuard) @Post('revoke') revoke(@Body() body:unknown,@Req() req:AuthedRequest){return this.hub.revokePair(req.principal,parse(z.object({id:uuid}).strict(),body).id);}
}
@UseGuards(AuthGuard)
@Controller('device')
export class DeviceController {
 constructor(@Inject(HubService) private readonly hub:HubService){}
 @Post('heartbeat') heartbeat(@Body() body:unknown,@Req() req:AuthedRequest){return this.hub.heartbeat(req.principal,parse(heartbeat,body));}
 @Get('policy') async policy(@Req() req:AuthedRequest){const p=device(req.principal),settings=await this.hub.settings(p.userId);return {maxFileBytes:settings.maxFileBytes,maxSessionMinutes:settings.maxSessionMinutes};}
 @Get('requests') requests(@Req() req:AuthedRequest){return this.hub.deviceRequests(req.principal);}
 @Post('revoke') revoke(@Req() req:AuthedRequest){const p=device(req.principal);return this.hub.revokeDevice(p,p.deviceId);}
 @Post('rotate') rotate(@Req() req:AuthedRequest){return this.hub.rotateDevice(req.principal);}
}
@UseGuards(AuthGuard)
@Controller('sessions')
export class SessionsController {
 constructor(@Inject(HubService) private readonly hub:HubService){}
 @Get() list(@Req() req:AuthedRequest){return this.hub.listSessions(req.principal);}
 @Post() create(@Body() body:unknown,@Req() req:AuthedRequest){const input=parse(z.object({deviceId:uuid,requestedControl:z.boolean().default(false)}).strict(),body);return this.hub.createSession(req.principal,input.deviceId,input.requestedControl);}
 @Get(':id') async get(@Param('id') id:string,@Req() req:AuthedRequest){return sessionView(await this.hub.getSession(req.principal,parse(uuid,id)));}
 @Get(':id/ice') ice(@Param('id') id:string,@Req() req:AuthedRequest){return this.hub.ice(req.principal,parse(uuid,id));}
 @Post(':id/approve') approve(@Param('id') id:string,@Body() body:unknown,@Req() req:AuthedRequest){const input=parse(z.object({control:z.boolean()}).strict(),body);return this.hub.transition(req.principal,parse(uuid,id),'APPROVED',input.control);}
 @Post(':id/reject') reject(@Param('id') id:string,@Req() req:AuthedRequest){return this.hub.transition(req.principal,parse(uuid,id),'REJECTED');}
 @Post(':id/active') active(@Param('id') id:string,@Req() req:AuthedRequest){return this.hub.transition(req.principal,parse(uuid,id),'ACTIVE');}
 @Post(':id/end') end(@Param('id') id:string,@Req() req:AuthedRequest){return this.hub.end(req.principal,parse(uuid,id));}
 @Post(':id/control/request') requestControl(@Param('id') id:string,@Req() req:AuthedRequest){return this.hub.control(req.principal,parse(uuid,id),'request');}
 @Post(':id/control/approve') approveControl(@Param('id') id:string,@Req() req:AuthedRequest){return this.hub.control(req.principal,parse(uuid,id),'approve');}
 @Post(':id/control/revoke') revokeControl(@Param('id') id:string,@Req() req:AuthedRequest){return this.hub.control(req.principal,parse(uuid,id),'revoke');}
}
@UseGuards(AuthGuard)
@Controller('audit')
export class AuditController {
 constructor(@Inject(Db) private readonly db:Db){}
 @Get() list(@Req() req:AuthedRequest){const p=admin(req.principal);return this.db.auditEvent.findMany({where:{ownerId:p.userId},orderBy:{createdAt:'desc'},take:200});}
}
@UseGuards(AuthGuard)
@Controller('settings')
export class SettingsController {
 constructor(@Inject(HubService) private readonly hub:HubService,@Inject(Db) private readonly db:Db){}
 @Get() get(@Req() req:AuthedRequest){return this.hub.settings(admin(req.principal).userId);}
 @Patch() async update(@Body() body:unknown,@Req() req:AuthedRequest){const p=admin(req.principal),input=parse(z.object({maxSessionMinutes:z.number().int().min(1).max(120).optional(),retentionDays:z.number().int().min(7).max(365).optional(),maxFileBytes:z.number().int().min(1024).max(20971520).optional()}).strict(),body);await this.db.systemSettings.upsert({where:{ownerId:p.userId},update:input,create:{ownerId:p.userId,...input}});await this.hub.audit(p.userId,'SETTINGS_CHANGED',{actorId:p.userId,details:input});return this.hub.settings(p.userId);}
}
const fileSchema=z.object({sessionId:uuid,direction:z.enum(['TO_DEVICE','FROM_DEVICE']),name:z.string().min(1).max(255).refine(v=>!/[\/\\\x00-\x1f]/.test(v),'Apenas nome do arquivo'),size:z.number().int().min(0).max(20971520),sha256:z.string().regex(/^[a-f0-9]{64}$/i),status:z.enum(['REQUESTED','COMPLETED','CANCELED','FAILED'])}).strict();
@UseGuards(AuthGuard)
@Controller('files')
export class FilesController {
 constructor(@Inject(HubService) private readonly hub:HubService,@Inject(Db) private readonly db:Db){}
 @Post() async record(@Body() body:unknown,@Req() req:AuthedRequest){const input=parse(fileSchema,body),s=await this.hub.signalAuthorized(req.principal,input.sessionId),settings=await this.hub.settings(req.principal.userId);if(s.status!=='ACTIVE')throw new BadRequestException({code:'SESSION_NOT_ACTIVE',message:'É necessária uma sessão ativa.'});if(input.size>settings.maxFileBytes)throw new BadRequestException({code:'FILE_TOO_LARGE',message:'Arquivo excede o limite configurado.'});const transfer=await this.db.fileTransfer.create({data:input});await this.hub.audit(req.principal.userId,'FILE_TRANSFER_REPORTED',{deviceId:s.deviceId,sessionId:s.id,details:{transferId:transfer.id,direction:input.direction,size:input.size,status:input.status}});return transfer;}
 @Get() async list(@Req() req:AuthedRequest){const p=admin(req.principal);return this.db.fileTransfer.findMany({where:{session:{operatorId:p.userId}},orderBy:{createdAt:'desc'},take:100});}
}
@Controller('health')
export class HealthController {
 constructor(@Inject(Db) private readonly db:Db){}
 @Get() async health(){await this.db.$queryRaw`SELECT 1`;return {status:'ok',service:'mob-api',time:new Date(),signaling:'https-polling',storage:'postgresql'};}
}

@UseGuards(AuthGuard)
@Controller('users')
export class UsersController {
 constructor(@Inject(Db) private readonly db:Db){}
 @Get('me') async me(@Req() req:AuthedRequest){const p=admin(req.principal);return this.db.user.findUniqueOrThrow({where:{id:p.userId},select:{id:true,email:true,mfaEnabled:true,createdAt:true}});}
}

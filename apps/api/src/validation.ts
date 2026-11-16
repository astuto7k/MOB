import { BadRequestException } from '@nestjs/common';
import { z } from 'zod';
export function parse<T>(schema:z.ZodType<T>,value:unknown):T {const result=schema.safeParse(value); if(!result.success)throw new BadRequestException({code:'INVALID_INPUT',message:'Dados inválidos.',fields:result.error.issues.map(x=>({path:x.path.join('.'),message:x.message}))});return result.data;}
export const uuid=z.uuid();
export const password=z.string().min(12).max(128);
export const login=z.object({email:z.email().max(254).transform(v=>v.toLowerCase()),password:z.string().min(1).max(128),totp:z.string().regex(/^\d{6}$/).optional()}).strict();
export const pairingConfirm=z.object({code:z.string().regex(/^[A-Z2-9]{12}$/),name:z.string().trim().min(1).max(80),manufacturer:z.string().max(80),model:z.string().max(100),androidVersion:z.string().max(40),appVersion:z.string().max(40),publicKey:z.string().max(4096).optional()}).strict();
export const heartbeat=z.object({battery:z.number().int().min(0).max(100).nullable().optional(),charging:z.boolean().nullable().optional(),network:z.enum(['wifi','cellular','ethernet','offline','unknown','WIFI','CELLULAR','ETHERNET','OFFLINE','UNKNOWN']).optional(),permissions:z.record(z.string().max(40),z.boolean()).optional()}).strict();
export const signaling=z.discriminatedUnion('type',[
 z.object({type:z.literal('join'),sessionId:uuid}).strict(),
 z.object({type:z.enum(['offer','answer']),sessionId:uuid,payload:z.object({type:z.enum(['offer','answer']),sdp:z.string().min(1).max(131072)}).strict()}).strict(),
 z.object({type:z.literal('ice'),sessionId:uuid,payload:z.object({candidate:z.string().max(4096),sdpMid:z.string().max(100).nullable().optional(),sdpMLineIndex:z.number().int().min(0).max(32).nullable().optional(),usernameFragment:z.string().max(256).nullable().optional()}).strict()}).strict(),
]);

/** Wire protocol v1. All operations require an authenticated, locally approved session. */
export const PROTOCOL_VERSION=1;
export const MAX_FILE_BYTES=20*1024*1024;
export const FILE_CHUNK_BYTES=16*1024;
export const AUTHORIZATION_LEASE_MS=10_000;
export const SESSION_STATES=['REQUESTED','WAITING_DEVICE','WAITING_APPROVAL','APPROVED','CONNECTING','ACTIVE','ENDING','ENDED','REJECTED','EXPIRED','FAILED'] as const;
export type SessionStatus=typeof SESSION_STATES[number];
export interface Device {id:string;name:string;manufacturer:string;model:string;androidVersion:string;appVersion:string;online:boolean;lastSeenAt:string|null;battery:number|null;charging:boolean|null;network:string|null;permissions:Record<string,boolean>;revokedAt:string|null;createdAt:string;}
export interface RemoteSession {id:string;deviceId:string;operatorId:string;status:SessionStatus;requestedControl:boolean;controlApproved:boolean;createdAt:string;expiresAt:string;startedAt:string|null;endedAt:string|null;endReason:string|null;device?:Device;leaseSeconds:10;}
export type SignalClientMessage={type:'join';sessionId:string}|{type:'offer'|'answer';sessionId:string;payload:{type:'offer'|'answer';sdp:string}}|{type:'ice';sessionId:string;payload:{candidate:string;sdpMid?:string|null;sdpMLineIndex?:number|null;usernameFragment?:string|null}};
export type SignalServerMessage=SignalClientMessage|{type:'joined';sessionId:string;peerPresent:boolean}|{type:'peer-ready'|'peer-joined';sessionId:string}|{type:'session';sessionId:string;payload:RemoteSession}|{type:'error';code:string;message:string};
export type ControlCommand=({type:'tap';x:number;y:number}|{type:'swipe';x:number;y:number;toX:number;toY:number;durationMs:number}|{type:'back'|'home'}|{type:'text';text:string})&{seq:number};
export type ControlResult={type:'control-result';seq:number;ok:boolean};
export type FileMessage={type:'file-pick'}|{type:'file-offer';id:string;name:string;size:number;sha256:string;direction:'upload'|'download'}|{type:'file-accept'|'file-complete'|'file-cancel';id:string}|{type:'file-result';id:string;ok:boolean};
/** Coordinates are normalized 0..1. Android independently validates before execution. */
export function validControl(command:unknown):command is ControlCommand{
 if(!command||typeof command!=='object')return false;const c=command as Record<string,unknown>;
 if(!Number.isSafeInteger(c.seq)||Number(c.seq)<0)return false;
 const coordinate=(key:string)=>typeof c[key]==='number'&&Number.isFinite(c[key])&&Number(c[key])>=0&&Number(c[key])<=1;
 switch(c.type){case'tap':return coordinate('x')&&coordinate('y');case'swipe':return coordinate('x')&&coordinate('y')&&coordinate('toX')&&coordinate('toY')&&typeof c.durationMs==='number'&&c.durationMs>=100&&c.durationMs<=1500;case'back':case'home':return true;case'text':return typeof c.text==='string'&&c.text.length>0&&c.text.length<=256&&!/[\u0000-\u001f\u007f]/.test(c.text);default:return false;}
}

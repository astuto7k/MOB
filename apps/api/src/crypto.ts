import { createCipheriv, createDecipheriv, createHash, createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
export const token = (bytes = 32) => randomBytes(bytes).toString('base64url');
export const digest = (value:string) => createHash('sha256').update(value).digest('hex');
export const equal = (a:string,b:string) => a.length===b.length && timingSafeEqual(Buffer.from(a),Buffer.from(b));
export function encrypt(secret:string,key:Buffer) {
  const iv=randomBytes(12), cipher=createCipheriv('aes-256-gcm',key,iv);
  const data=Buffer.concat([cipher.update(secret,'utf8'),cipher.final()]);
  return Buffer.concat([iv,cipher.getAuthTag(),data]).toString('base64');
}
export function decrypt(value:string,key:Buffer) {
  const raw=Buffer.from(value,'base64'); if(raw.length<29) throw new Error('Invalid encrypted value');
  const cipher=createDecipheriv('aes-256-gcm',key,raw.subarray(0,12)); cipher.setAuthTag(raw.subarray(12,28));
  return Buffer.concat([cipher.update(raw.subarray(28)),cipher.final()]).toString('utf8');
}
const alphabet='ABCDEFGHIJKLMNOPQRSTUVWXYZ234567';
export function base32(data:Buffer) {
  let out='',bits=0,value=0; for(const byte of data){value=(value<<8)|byte;bits+=8;while(bits>=5){out+=alphabet[(value>>>(bits-5))&31];bits-=5;}}
  if(bits) out+=alphabet[(value<<(5-bits))&31]; return out;
}
export function unbase32(text:string) {
  let bits=0,value=0; const data:number[]=[]; for(const ch of text.toUpperCase().replace(/=+$/,'')){const n=alphabet.indexOf(ch);if(n<0)throw new Error('Invalid base32');value=(value<<5)|n;bits+=5;if(bits>=8){data.push((value>>>(bits-8))&255);bits-=8;}} return Buffer.from(data);
}
export function totp(secret:string,step:number) {
  const counter=Buffer.alloc(8);counter.writeBigUInt64BE(BigInt(step));const mac=createHmac('sha1',unbase32(secret)).update(counter).digest();const offset=mac[19]&15;
  return ((mac.readUInt32BE(offset)&0x7fffffff)%1000000).toString().padStart(6,'0');
}
export function verifyTotp(secret:string,code:string,lastStep:bigint|null=null,now=Date.now()):number|null {
  if(!/^\d{6}$/.test(code))return null;const current=Math.floor(now/30000);
  for(const step of [current,current-1,current+1]) if((lastStep===null||BigInt(step)>lastStep)&&equal(totp(secret,step),code))return step;
  return null;
}
export function csrfFor(rawToken:string,key:Buffer){return createHmac('sha256',key).update(`csrf:${rawToken}`).digest('base64url');}
export function turnCredential(secret:string,username:string){return createHmac('sha1',secret).update(username).digest('base64');}

import test from 'node:test';
import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import { ForbiddenException } from '@nestjs/common';
import type { Db } from '../src/db';

test('missing device relation ends authorization and returns a deliberate refusal',async()=>{
 process.env.DATABASE_URL??='postgresql://test:test@127.0.0.1:5432/test';
 process.env.MASTER_KEY??=randomBytes(32).toString('base64');
 const {HubService}=await import('../src/hub');
 const db={remoteSession:{findFirst:async()=>({id:'session',deviceId:'device',operatorId:'owner',status:'ACTIVE',device:null})}} as unknown as Db;
 const hub=new HubService(db);const ended:unknown[]=[];
 hub.terminate=async(...args)=>{ended.push(args);};
 await assert.rejects(hub.getSession({kind:'admin',userId:'owner',adminSessionId:'admin-session',csrfToken:'csrf'},'session'),error=>{
  assert.ok(error instanceof ForbiddenException);assert.equal((error.getResponse() as {code:string}).code,'AUTHORIZATION_UNAVAILABLE');return true;
 });
 assert.deepEqual(ended,[['session','ENDED','AUTHORIZATION_UNAVAILABLE']]);
});

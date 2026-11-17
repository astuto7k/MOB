import 'reflect-metadata';
import { createInterface } from 'node:readline/promises';
import { stdin,stdout } from 'node:process';
import { z } from 'zod';
import { Db } from './db.js';
import { hashPassword } from './auth.js';
import { password } from './validation.js';
async function bootstrap(){
 const db=new Db();await db.$connect();try{
  if(await db.user.count())throw new Error('An owner already exists. Bootstrap is disabled.');
  let input:{email:string;password:string};
  if(!stdin.isTTY){let raw='';for await(const chunk of stdin){raw+=chunk.toString();if(raw.length>4096)throw new Error('Input too long');}input=z.object({email:z.email().transform(x=>x.toLowerCase()),password}).strict().parse(JSON.parse(raw));}
  else{const readline=createInterface({input:stdin,output:stdout});const email=await readline.question('E-mail do proprietário: ');readline.close();stdout.write('Senha (8+ caracteres; entrada oculta): ');stdin.setRawMode(true);stdin.resume();const secret=await new Promise<string>((resolve,reject)=>{let value='';const onData=(chunk:Buffer)=>{for(const char of chunk.toString()){if(char==='\u0003'){stdin.off('data',onData);reject(new Error('Canceled'));return;}if(char==='\n'||char==='\r'){stdin.off('data',onData);resolve(value);return;}if(char==='\u007f')value=value.slice(0,-1);else value+=char;}};stdin.on('data',onData);});stdin.setRawMode(false);stdin.pause();stdout.write('\n');input=z.object({email:z.email().transform(x=>x.toLowerCase()),password}).parse({email,password:secret});}
  const user=await db.user.create({data:{email:input.email,passwordHash:await hashPassword(input.password)}});await db.systemSettings.create({data:{ownerId:user.id}});await db.auditEvent.create({data:{ownerId:user.id,actorId:user.id,type:'OWNER_BOOTSTRAPPED'}});console.log('Proprietário criado. Ative o MFA no painel e guarde os códigos de recuperação.');
 }finally{await db.$disconnect();}
}
void bootstrap().catch(e=>{if(stdin.isTTY)stdin.setRawMode(false);console.error(e instanceof Error?e.message:'Bootstrap failed');process.exitCode=1;});

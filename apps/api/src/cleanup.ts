import { Db } from './db';
export async function cleanup(db:Db){const owners=await db.user.findMany({select:{id:true,settings:true}});for(const owner of owners){const cutoff=new Date(Date.now()-(owner.settings?.retentionDays??90)*86400_000);await db.$transaction(async tx=>{
 await tx.auditEvent.deleteMany({where:{ownerId:owner.id,createdAt:{lt:cutoff}}});
 await tx.remoteSession.deleteMany({where:{operatorId:owner.id,status:{in:['ENDED','REJECTED','EXPIRED','FAILED']},endedAt:{lt:cutoff}}});
 await tx.pairingRequest.deleteMany({where:{ownerId:owner.id,expiresAt:{lt:cutoff}}});
 await tx.adminSession.deleteMany({where:{userId:owner.id,expiresAt:{lt:cutoff},remoteSessions:{none:{}}}});
 await tx.deviceCredential.deleteMany({where:{device:{ownerId:owner.id},expiresAt:{lt:cutoff}}});
 });}return {owners:owners.length};}
if(require.main===module){const db=new Db();void cleanup(db).then(r=>console.log(JSON.stringify(r))).finally(()=>db.$disconnect()).catch(()=>{console.error('Cleanup failed');process.exitCode=1;});}

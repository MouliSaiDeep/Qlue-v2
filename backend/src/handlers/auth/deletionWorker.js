const jobs=require('../../lib/deletionJob');
const {deleteAllUserData}=require('../../lib/accountDeletion');
const ddb=require('../../lib/dynamodb');
const firebase=require('../../lib/firebase');

exports.handler=async(event,context={})=>require('../../lib/deadline').withDeadline(context,async()=>{
  if(context.getRemainingTimeInMillis?.()<10000) return {success:true,deferred:true};
  const candidates=event.userId ? [await jobs.getDeletion(event.userId)] : await jobs.pendingJobs();
  for(const job of candidates.filter(Boolean)) {
    if(context.getRemainingTimeInMillis && context.getRemainingTimeInMillis()<10000) break;
    if(job.status==='COMPLETE') continue;
    // Old PUT URLs expire after 15 minutes; old workers finish within 2 minutes.
    // Keep the durable tombstone and wait 20 minutes before the final sweep.
    if(Date.now()<job.drainUntil) {await jobs.setStatus(job.userId,'WAITING_FOR_UPLOAD_EXPIRY');continue;}
    await jobs.setStatus(job.userId,'PURGING');
    const result=await deleteAllUserData(job.userId, {completed:job.checkpoints,
      onCheckpoint:(step,value)=>jobs.checkpoint(job.userId,step,value),
      shouldContinue:()=>!context.getRemainingTimeInMillis || context.getRemainingTimeInMillis()>10000});
    if(result.failures.length) {await jobs.setStatus(job.userId,'RETRYING',{categories:result.failures.map(x=>x.split(':')[0])});continue;}
    try {
      const profile=await ddb.delete(process.env.USERS_TABLE||'qlue-users',{userId:job.userId});
      if(!profile.success) throw profile.error;
      await require('../../lib/deadline').bounded(()=>firebase.deleteUser(job.userId),{label:'deleteIdentity'});
      await jobs.setStatus(job.userId,'COMPLETE');
    } catch {await jobs.setStatus(job.userId,'RETRYING',{category:'identity'});}
  }
  return {success:true};
},{maxMs:120000,reserveMs:10000});

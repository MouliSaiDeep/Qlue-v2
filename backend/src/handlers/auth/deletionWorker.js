const jobs=require('../../lib/deletionJob');
const {deleteAllUserData}=require('../../lib/accountDeletion');
const ddb=require('../../lib/dynamodb');
const firebase=require('../../lib/firebase');
const work=require('../../lib/eventWork');
const deadline=require('../../lib/deadline');
const {UpdateCommand}=require('@aws-sdk/lib-dynamodb');
const {randomUUID}=require('node:crypto');
const {deactivateConnectionsByUserId}=require('../../models/wsConnection');

async function processJob(event) {
  if(!event.userId) throw new Error('Deletion userId is required');
  const candidates=[await jobs.getDeletion(event.userId)];
  for(const job of candidates.filter(Boolean)) {
    if(job.status==='COMPLETE') continue;
    // Old PUT URLs expire after 15 minutes; old workers finish within 2 minutes.
    // Keep the durable tombstone and wait 20 minutes before the final sweep.
    if(Date.now()<job.drainUntil&&job.checkpoints?.firebaseIdentity&&job.checkpoints?.accessRevoked) {
      await work.enqueue({userId:job.userId},job.drainUntil);continue;
    }
    if(job.recoveryExpiresAt>Date.now()) {await work.enqueue({userId:job.userId},job.recoveryExpiresAt+1);continue;}
    const owner=randomUUID();
    await deadline.sendBounded(ddb.docClient,new UpdateCommand({TableName:jobs.TABLE,Key:{userId:job.userId},
      UpdateExpression:'SET recoveryOwner = :owner, recoveryExpiresAt = :expiry',
      ConditionExpression:'attribute_exists(userId) AND #s <> :complete AND (attribute_not_exists(recoveryExpiresAt) OR recoveryExpiresAt <= :now)',
      ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':owner':owner,':expiry':Date.now()+130000,':now':Date.now(),':complete':'COMPLETE'}}));
    let failureRecorded=false;
    try {
    // Identity removal must not wait for outstanding storage upload URLs.
    await deadline.bounded(()=>firebase.deleteUser(job.userId),{label:'deleteIdentity'});
    await jobs.checkpoint(job.userId,'firebaseIdentity',true);
    await deactivateConnectionsByUserId(job.userId);
    await jobs.checkpoint(job.userId,'accessRevoked',true);
    if(Date.now()<job.drainUntil) {
      await work.enqueue({userId:job.userId},job.drainUntil);
      continue;
    }
    await jobs.setStatus(job.userId,'PURGING');
    const result=await deleteAllUserData(job.userId, {completed:job.checkpoints,
      onCheckpoint:(step,value)=>jobs.checkpoint(job.userId,step,value),
      shouldContinue:()=>deadline.remaining()>10000});
    if(result.failures.length) {
      await jobs.setStatus(job.userId,'RETRYING',{categories:result.failures.map(x=>x.split(':')[0])});
      failureRecorded=true;
      throw new Error('Account purge requires retry');
    }
    try {
      const profile=await ddb.delete(process.env.USERS_TABLE||'qlue-users',{userId:job.userId});
      if(!profile.success) throw profile.error;
      await require('../../lib/deadline').bounded(()=>firebase.deleteUser(job.userId),{label:'deleteIdentity'});
      await jobs.setStatus(job.userId,'COMPLETE');
    } catch(error) {await jobs.setStatus(job.userId,'RETRYING',{category:'identity'});failureRecorded=true;throw error;}
    } catch(error) {
      if(!failureRecorded)await jobs.setStatus(job.userId,'RETRYING',{category:'identity'});
      throw error;
    } finally {
      await deadline.finalize(()=>deadline.sendBounded(ddb.docClient,new UpdateCommand({TableName:jobs.TABLE,Key:{userId:job.userId},
        UpdateExpression:'REMOVE recoveryOwner, recoveryExpiresAt',ConditionExpression:'recoveryOwner = :owner',ExpressionAttributeValues:{':owner':owner}}),{finish:true}));
    }
  }
  return {success:true};
}

exports.handler=work.handler({worker:'deletion',
  maxMs:120000,
  onStream:async(job,old,record)=>{
    if(!job.userId||job.status==='COMPLETE')return;
    if(record.eventName!=='INSERT'&&!(job.status==='PENDING'&&work.changed(job,old,['status'])))return;
    await work.enqueue({userId:job.userId},Date.now());
  },
  process:processJob,
  direct:processJob
});

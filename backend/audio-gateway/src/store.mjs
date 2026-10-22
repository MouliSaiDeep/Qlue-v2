import { createHash, randomInt } from 'node:crypto';
import { GetCommand, TransactWriteCommand, UpdateCommand } from '@aws-sdk/lib-dynamodb';
export class Store {
  constructor(db,{table,sessions,deletions,now=()=>Date.now(),slots=4,dailyLimit=160}) {
    if(!Number.isSafeInteger(slots)||slots<1||slots>20||!Number.isSafeInteger(dailyLimit)||dailyLimit<1||dailyLimit>1000)throw Error('INVALID_STREAM_LIMITS');
    Object.assign(this,{db,table,sessions,deletions,now,slots,dailyLimit});
  }
  async get(pk){return (await this.db.send(new GetCommand({TableName:this.table,Key:{pk},ConsistentRead:true}))).Item;}
  async authorize(t) {
    const [session,deletion,control]=await Promise.all([
      this.db.send(new GetCommand({TableName:this.sessions,Key:{sessionId:t.sessionId},ConsistentRead:true})),
      this.db.send(new GetCommand({TableName:this.deletions,Key:{userId:t.userId},ConsistentRead:true})),this.get('CONTROL')]);
    if(control?.rolloutEnabled!==true||!Number.isInteger(control.globalStreamSlots)||control.globalStreamSlots<1||control.globalStreamSlots>20||
      !Number.isInteger(control.dailyStreamLimit)||control.dailyStreamLimit<1||control.dailyStreamLimit>1000||deletion.Item||!session.Item||session.Item.userId!==t.userId||
      session.Item.currentState!=='USER_RESPONDING'||session.Item.lastTurnPayload?.turnId!==t.turnId||t.streamExpiresAt*1000<=this.now())throw Error('STREAM_AUTHORIZATION_ENDED');
    return control;
  }
  async redeem(ticket) {
    if(typeof ticket!=='string'||!/^[A-Za-z0-9_-]{43}$/.test(ticket))throw Error('INVALID_TICKET');
    const pk='TICKET#'+createHash('sha256').update(ticket).digest('hex'),t=await this.get(pk),now=Math.floor(this.now()/1000);
    if(!t||t.expiresAt<=now||t.used)throw Error('INVALID_TICKET');
    const control=await this.authorize(t);
    const dailyKey='DAY#'+Math.floor(now/86400)+'#USER#'+t.userId;
    const daily=await this.get(dailyKey);
    if((daily?.count||0)>=Math.min(this.dailyLimit,control.dailyStreamLimit))throw Error('STREAM_DAILY_LIMIT');
    const capacity=Math.min(this.slots,control.globalStreamSlots);
    // Spread concurrent replicas across shared slots instead of making every
    // caller collide on SLOT#0, then SLOT#1. Transactions remain authoritative.
    const start=randomInt(capacity);
    for(let attempt=0;attempt<capacity;attempt++){
      const slot=(start+attempt)%capacity;
      const lease={streamId:t.streamId,userId:t.userId,expiresAt:t.streamExpiresAt+10,ttl:t.streamExpiresAt+60};
      try {await this.db.send(new TransactWriteCommand({TransactItems:[
        {Update:{TableName:this.table,Key:{pk},UpdateExpression:'SET used = :yes',ConditionExpression:'attribute_not_exists(used) AND expiresAt > :now',ExpressionAttributeValues:{':yes':true,':now':now}}},
        {Put:{TableName:this.table,Item:{pk:'LEASE#'+t.userId,...lease},ConditionExpression:'attribute_not_exists(pk) OR expiresAt <= :now',ExpressionAttributeValues:{':now':now}}},
        {Put:{TableName:this.table,Item:{pk:'SLOT#'+slot,...lease},ConditionExpression:'attribute_not_exists(pk) OR expiresAt <= :now',ExpressionAttributeValues:{':now':now}}},
        // A stream is an answer capture, not an interview. Each owner has an
        // independent daily retry guard (10 interviews × 8 answers × 2 starts).
        // userId also makes this short-lived row part of account deletion.
        {Update:{TableName:this.table,Key:{pk:dailyKey},UpdateExpression:'SET #n = if_not_exists(#n,:zero) + :one, #ttl = :ttl, userId = :uid',
          ConditionExpression:'attribute_not_exists(#n) OR #n < :max',ExpressionAttributeNames:{'#n':'count','#ttl':'ttl'},ExpressionAttributeValues:{':zero':0,':one':1,':max':Math.min(this.dailyLimit,control.dailyStreamLimit),':ttl':now+172800,':uid':t.userId}}},
        {ConditionCheck:{TableName:this.deletions,Key:{userId:t.userId},ConditionExpression:'attribute_not_exists(userId)'}},
        {ConditionCheck:{TableName:this.sessions,Key:{sessionId:t.sessionId},ConditionExpression:'userId = :uid AND currentState = :state AND lastTurnPayload.turnId = :turn',ExpressionAttributeValues:{':uid':t.userId,':state':'USER_RESPONDING',':turn':t.turnId}}},
        {ConditionCheck:{TableName:this.table,Key:{pk:'CONTROL'},ConditionExpression:'rolloutEnabled = :yes AND globalStreamSlots = :slots AND dailyStreamLimit = :limit',ExpressionAttributeValues:{':yes':true,':slots':control.globalStreamSlots,':limit':control.dailyStreamLimit}}},
        {Put:{TableName:this.table,Item:{...t,pk:'STREAM#'+t.streamId,status:'STREAMING',offsetSamples:t.offsetSamples,nextOffsetSamples:t.offsetSamples,expiresAt:now+3600,ttl:now+3600},ConditionExpression:'attribute_not_exists(pk)'}}
      ]}));return {...t,slot};}
      catch(error){if(error.name!=='TransactionCanceledException')throw error;
        // All-or-nothing: a failed global slot claim does not consume a ticket.
        const current=await this.get(pk),active=await this.get('LEASE#'+t.userId);
        if(current?.used||(active&&active.expiresAt>now))throw Error('STREAM_ALREADY_ACTIVE');
        const spent=await this.get(dailyKey);
        if((spent?.count||0)>=Math.min(this.dailyLimit,control.dailyStreamLimit))throw Error('STREAM_DAILY_LIMIT');
      }
    }
    throw Error('STREAM_CAPACITY');
  }
  async finish(t,result) {
    if(Buffer.byteLength(JSON.stringify(result))>300000)throw Error('TRANSCRIPT_EVIDENCE_LIMIT');
    // Fenced writes prevent account deletion from being followed by new PII.
    await this.db.send(new TransactWriteCommand({TransactItems:[
      {ConditionCheck:{TableName:this.deletions,Key:{userId:t.userId},ConditionExpression:'attribute_not_exists(userId)'}},
      {Update:{TableName:this.table,Key:{pk:'STREAM#'+t.streamId},ConditionExpression:'userId = :uid AND #s = :active',
        UpdateExpression:'SET #s = :status, originalTranscript = :text, confidence = :confidence, unfinished = :unfinished, nextOffsetSamples = :next, vocabulary = :vocab, measurements = :metrics, #segments = :segments',
        ExpressionAttributeNames:{'#s':'status','#segments':'segments'},ExpressionAttributeValues:{':uid':t.userId,':active':'STREAMING',':status':result.status,
          ':text':result.text,':confidence':result.confidence,':unfinished':result.unfinished,':next':result.nextOffsetSamples,':vocab':result.vocabulary,':metrics':result.measurements,':segments':result.segments}}}
    ]}));
  }
  async release(t) {
    // Releasing never deletes a replacement lease belonging to another stream.
    const actions=['LEASE#'+t.userId,'SLOT#'+t.slot].map(pk=>({Delete:{TableName:this.table,Key:{pk},ConditionExpression:'streamId = :id',ExpressionAttributeValues:{':id':t.streamId}}}));
    try{await this.db.send(new TransactWriteCommand({TransactItems:actions}));}
    catch(error){if(error.name!=='TransactionCanceledException')throw error;}
  }
}

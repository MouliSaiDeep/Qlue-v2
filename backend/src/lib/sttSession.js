// Ticket hashes and short-lived ASR evidence. No raw audio is stored here.
const {randomBytes,createHash}=require('node:crypto');
const {GetCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
const ddb=require('./dynamodb'),deadline=require('./deadline');
const table=()=>process.env.STT_SESSIONS_TABLE;
const hash=value=>createHash('sha256').update(value).digest('hex');
const fail=(code,statusCode=409)=>Object.assign(new Error(code),{code,statusCode});
const read=async pk=>(await deadline.sendBounded(ddb.docClient,new GetCommand({TableName:table(),Key:{pk},ConsistentRead:true}))).Item;
async function issue(uid,body,identityExpiresAt){
  if(process.env.AWS_STT_ENABLED!=='true'||!table())throw fail('AWS_STT_DISABLED',503);
  if(!body||typeof body!=='object'||Array.isArray(body))throw fail('INVALID_CAPTURE',400);
  const endpoint=process.env.STT_GATEWAY_URL;
  if(!/^wss:\/\/[a-zA-Z0-9.-]+(?::443)?\/audio$/.test(endpoint||''))throw fail('AWS_STT_UNCONFIGURED',503);
  const {sessionId,turnId,captureId,epoch,language='en-IN',stability='off'}=body;
  if(!/^[a-zA-Z0-9-]{1,80}$/.test(sessionId||'')||typeof turnId!=='string'||turnId.length>200||!turnId||
    !/^[a-zA-Z0-9-]{1,80}$/.test(captureId||'')||!Number.isSafeInteger(epoch)||epoch<1)throw fail('INVALID_CAPTURE',400);
  if(!['en-IN','en-US','en-GB','hi-IN'].includes(language)||!['off','low','medium','high'].includes(stability))throw fail('INVALID_STT_CONFIG',400);
  const session=await require('../models/session').getSessionById(sessionId);
  if(!session||session.userId!==uid)throw fail('FORBIDDEN',403);
  if(session.currentState!=='USER_RESPONDING'||session.lastTurnPayload?.turnId!==turnId)throw fail('STALE_QUESTION');
  await require('./deletionJob').assertNotDeleting(uid);
  const now=Math.floor(Date.now()/1000), streamId=randomBytes(16).toString('hex'),ticket=randomBytes(32).toString('base64url');
  const expiresAt=Math.min(now+30,identityExpiresAt),streamExpiresAt=Math.min(now+180,identityExpiresAt);
  if(!Number.isFinite(expiresAt)||expiresAt<=now+5)throw fail('IDENTITY_EXPIRED',401);
  // Resume has NO automatic replay: the user confirms/repeats the interrupted
  // portion. The absolute offset is the prior server-received PCM boundary.
  let offsetSamples=0,previousStreamId=null,priorEvidence=null;
  if(body.previousStreamId){
    if(!/^[a-f0-9]{32}$/.test(body.previousStreamId))throw fail('INVALID_RESUME',400);
    const previous=await read('STREAM#'+body.previousStreamId);
    if(!previous||previous.userId!==uid||previous.sessionId!==sessionId||previous.turnId!==turnId||previous.captureId!==captureId||
      !['FINISHED','INTERRUPTED','CANCELLED'].includes(previous.status)||previous.expiresAt<=now)throw fail('INVALID_RESUME');
    if(previous.epoch>=epoch)throw fail('STALE_CAPTURE');
    if(previous.status==='FINISHED')return {priorCompleted:true,streamId:previous.streamId,captureId,originalTranscript:previous.originalTranscript,segments:previous.segments||[]};
    offsetSamples=previous.nextOffsetSamples;previousStreamId=previous.streamId;
    priorEvidence={streamId:previous.streamId,captureId,originalTranscript:previous.originalTranscript||'',segments:previous.segments||[],unfinished:previous.unfinished||[]};
  }
  const topic=['RESUME','JD','WEBSITE'].includes(session.moduleType)?'technical':'general';
  // Never start a paid stream or return a ticket while its host is stopped.
  // Ownership, current question, identity expiry and deletion were checked above.
  if(process.env.AUDIO_HOST_WAKE_FUNCTION){
    const host=await require('./audioHost').wake(uid,sessionId);
    if(!host.ready)throw fail(host.code==='STT_GATEWAY_WARMING'?'STT_GATEWAY_WARMING':'STT_UNAVAILABLE',503);
  }
  const item={pk:'TICKET#'+hash(ticket),userId:uid,sessionId,turnId,captureId,epoch,streamId,expiresAt,streamExpiresAt,
    language,stability,sampleRate:16000,offsetSamples,previousStreamId,topic,ttl:expiresAt+300};
  const bucket=Math.floor(now/60);
  try {await deadline.sendBounded(ddb.docClient,new TransactWriteCommand({TransactItems:[
    require('./deletionJob').deletionFence(uid),
    {ConditionCheck:{TableName:process.env.SESSIONS_TABLE,Key:{sessionId},ConditionExpression:'userId = :uid AND currentState = :state AND lastTurnPayload.turnId = :turn',ExpressionAttributeValues:{':uid':uid,':state':'USER_RESPONDING',':turn':turnId}}},
    {ConditionCheck:{TableName:table(),Key:{pk:'CONTROL'},ConditionExpression:'rolloutEnabled = :yes',ExpressionAttributeValues:{':yes':true}}},
    {Update:{TableName:table(),Key:{pk:`ISSUE#${uid}#${bucket}`},UpdateExpression:'SET #n = if_not_exists(#n,:zero) + :one, #ttl = :ttl, userId = :uid',ConditionExpression:'attribute_not_exists(#n) OR #n < :max',ExpressionAttributeNames:{'#n':'count','#ttl':'ttl'},ExpressionAttributeValues:{':zero':0,':one':1,':max':12,':ttl':now+120,':uid':uid}}},
    {Put:{TableName:table(),Item:item,ConditionExpression:'attribute_not_exists(pk)'}}
  ]}));}catch(error){if(error.name==='TransactionCanceledException')throw fail('STT_ADMISSION_DENIED',429);throw error;}
  return {ticket,gatewayUrl:endpoint,streamId,captureId,epoch,offsetSamples,previousStreamId,expiresAt,streamExpiresAt,
    language,stability,sampleRate:16000,chunkBytes:2560,...(priorEvidence?{priorEvidence}:{})};
}
async function evidence(uid,session,body){
  if(body.asr!==undefined)delete body.asr; // Client claims are never authoritative.
  if(!body.stt)return null;
  if(!table())throw fail('AWS_STT_DISABLED',503);
  const ids=body.stt.streamIds;
  if(body.stt.provider!=='aws-transcribe'||!Array.isArray(ids)||!ids.length||ids.length>4||new Set(ids).size!==ids.length||ids.some(id=>!/^([a-f0-9]{32})$/.test(id)))throw fail('INVALID_ASR_REFERENCE',400);
  const streams=[];
  for(const id of ids){const s=await read('STREAM#'+id);
    if(!s||s.userId!==uid||s.sessionId!==session.sessionId||s.turnId!==body.turnId||s.expiresAt<Date.now()/1000||
      !['FINISHED','INTERRUPTED','CANCELLED'].includes(s.status))throw fail('ASR_NOT_FINAL');
    streams.push(s);
  }
  if(streams.at(-1).status!=='FINISHED'||streams.at(-1).unfinished?.length)throw fail('ASR_NOT_FINAL');
  for(let i=1;i<streams.length;i++)if(streams[i].previousStreamId!==streams[i-1].streamId||streams[i].captureId!==streams[0].captureId)throw fail('INVALID_ASR_CHAIN');
  if(streams[0].previousStreamId)throw fail('INCOMPLETE_ASR_CHAIN');
  if(streams.length>1&&body.stt.confirmedRecovery!==true)throw fail('ASR_RECOVERY_CONFIRMATION_REQUIRED');
  const original=streams.map(s=>s.originalTranscript).filter(Boolean).join(' '),edited=original!==body.textTranscript;
  if(edited&&body.stt.edited!==true)throw fail('ASR_EDIT_CONFIRMATION_REQUIRED');
  return {provider:'aws-transcribe',streamIds:ids,originalTranscript:original,...(edited?{correctedTranscript:body.textTranscript}:{}),
    uncertainty:require('./feedbackAssessment').uncertainty(streams),
    confidenceAppliesTo:'original-recognition-only',recognition:streams.map(s=>({streamId:s.streamId,language:s.language,
      vocabulary:s.vocabulary,offsetSamples:s.offsetSamples,nextOffsetSamples:s.nextOffsetSamples,confidence:s.confidence,interrupted:s.status!=='FINISHED'}))};
}
module.exports={issue,evidence,hash};

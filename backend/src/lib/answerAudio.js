// Temporary private recordings. Only bounded derived measurements enter prompts.
const {createHash,randomUUID}=require('node:crypto');
const {UpdateCommand}=require('@aws-sdk/lib-dynamodb');
const {S3Client,GetObjectCommand,ListObjectsV2Command,DeleteObjectsCommand}=require('@aws-sdk/client-s3');
const {createPresignedPost}=require('@aws-sdk/s3-presigned-post');
const ddb=require('./dynamodb');
const {sendBounded,bounded,remaining,streamBounded}=require('./deadline');
const client=new S3Client({region:process.env.AWS_REGION||'us-east-1'});
const table=()=>process.env.SESSIONS_TABLE||'qlue-sessions';
const bucket=()=>process.env.ANSWER_AUDIO_BUCKET;
const MAX_BYTES=6400044; // 200 seconds PCM16 mono 16kHz, canonical WAV only.
const idFor=id=>createHash('sha256').update(id).digest('hex');
function error(code){return Object.assign(new Error(code),{code});}
function closed(s){return !s||s.answerAudioClosed||s.discarded||s.feedbackExpected===false||['COMPLETE','FAILED'].includes(s.feedbackStatus);}
async function read(sessionId){const r=await ddb.get(table(),{sessionId},{consistentRead:true});if(!r.success)throw r.error||error('READ_FAILED');return r.data;}
async function reserve(s,userId,body){
 if(s.userId!==userId)throw error('FORBIDDEN');
 if(closed(s))throw error('AUDIO_CLOSED');
 const {clientTurnId,fileSize,sha256}=body;
 if(typeof clientTurnId!=='string'||clientTurnId.length>180||!Number.isInteger(fileSize)||fileSize<32044||fileSize>MAX_BYTES||!(/^[a-f0-9]{64}$/.test(sha256||'')))throw error('INVALID_AUDIO');
 if(!(s.acceptedAnswerIds||[]).includes(clientTurnId))throw error('ANSWER_PENDING');
 let captureSegments;
 try {captureSegments=require('./deliveryAnalysis').segments(body.captureSegments,(fileSize-44)/2);}catch(_){throw error('INVALID_AUDIO');}
 await require('./deletionJob').assertNotDeleting(userId);
 const id=idFor(clientTurnId),key=`answers/${s.sessionId}/${id}/${sha256}.wav`;
 const existing=s.answerAudio?.[id];
 if(existing&&(existing.sha256!==sha256||existing.fileSize!==fileSize||JSON.stringify(existing.captureSegments||null)!==JSON.stringify(captureSegments)))throw error('AUDIO_CHANGED');
 const expiresAt=Date.now()+60000;
 // Initialize the parent map separately; DynamoDB disallows overlapping paths.
 const fence='attribute_exists(sessionId) AND userId = :uid AND (attribute_not_exists(answerAudioClosed) OR answerAudioClosed = :open)';
 await ddb.fencedSend(new UpdateCommand({TableName:table(),Key:{sessionId:s.sessionId},
  UpdateExpression:'SET answerAudio = if_not_exists(answerAudio, :empty)',ConditionExpression:fence,
  ExpressionAttributeValues:{':uid':userId,':open':false,':empty':{}}}),userId);
 const entry={clientTurnId,key,sha256,fileSize,...(captureSegments?{captureSegments}:{}),status:existing?.status||'PENDING',...(existing?.durationSeconds?{durationSeconds:existing.durationSeconds}:{}),expiresAt};
 await ddb.fencedSend(new UpdateCommand({TableName:table(),Key:{sessionId:s.sessionId},
  UpdateExpression:'SET answerAudio.#id = if_not_exists(answerAudio.#id, :entry), answerAudioLastExpiry = :expiry',
  ConditionExpression:`${fence} AND contains(acceptedAnswerIds, :turn) AND (attribute_not_exists(answerAudio.#id) OR answerAudio.#id.sha256 = :sha)`,
  ExpressionAttributeNames:{'#id':id},ExpressionAttributeValues:{':uid':userId,':open':false,':turn':clientTurnId,':sha':sha256,':entry':entry,':expiry':expiresAt}}),userId);
 const upload=await bounded(()=>createPresignedPost(client,{Bucket:bucket(),Key:key,Expires:60,
  Fields:{'Content-Type':'audio/wav'},Conditions:[['content-length-range',fileSize,fileSize],['eq','$Content-Type','audio/wav']]}),{label:'answerAudioSigning'});
 return {uploadUrl:upload.url,uploadFields:upload.fields,uploadMethod:'POST',expiresIn:60};
}
function wavDuration(b){
 if(!Buffer.isBuffer(b)||b.length<44||b.length>MAX_BYTES||b.toString('ascii',0,4)!=='RIFF'||b.readUInt32LE(4)!==b.length-8||b.toString('ascii',8,16)!=='WAVEfmt '||b.readUInt32LE(16)!==16||b.readUInt16LE(20)!==1||b.readUInt16LE(22)!==1||b.readUInt32LE(24)!==16000||b.readUInt32LE(28)!==32000||b.readUInt16LE(32)!==2||b.readUInt16LE(34)!==16||b.toString('ascii',36,40)!=='data'||b.readUInt32LE(40)!==b.length-44||(b.length-44)%2)throw error('INVALID_WAV');
 return (b.length-44)/32000;
}
async function remove(keys){if(!keys.length)return;const r=await sendBounded(client,new DeleteObjectsCommand({Bucket:bucket(),Delete:{Objects:keys.map(Key=>({Key})),Quiet:true}}));if(r.Errors?.length)throw error('AUDIO_DELETE_FAILED');}
async function arrived({bucket:receivedBucket,key}){
 if(receivedBucket!==bucket())throw error('WRONG_BUCKET');
 const match=/^answers\/([a-zA-Z0-9-]{1,80})\/([a-f0-9]{64})\/([a-f0-9]{64}|clip)\.wav$/.exec(key);
 if(!match){await remove([key]);return;}
 const [,sessionId,id]=match;
 const s=await read(sessionId),entry=s?.answerAudio?.[id];
 if(closed(s)||!entry||entry.key!==key||!(s.acceptedAnswerIds||[]).includes(entry.clientTurnId)){await remove([key]);return;}
 try {await require('./deletionJob').assertNotDeleting(s.userId);}catch(e){if(e.code==='ACCOUNT_DELETING'){await remove([key]);return;}throw e;}
 if(entry.status==='READY')return;
 if(entry.status==='INVALID'){await remove([key]);return;}
 const owner=randomUUID(),now=Date.now();
 // At-least-once S3 notifications share one bounded lease. A crashed owner can
 // be recovered, but a completed measurement can never be claimed again.
 try {
  await ddb.fencedSend(new UpdateCommand({TableName:table(),Key:{sessionId},
   UpdateExpression:'SET answerAudio.#id.#status = :processing, answerAudio.#id.processingOwner = :owner, answerAudio.#id.processingExpiresAt = :expiry, answerAudio.#id.processingAttempts = if_not_exists(answerAudio.#id.processingAttempts, :zero) + :one',
   ConditionExpression:'attribute_exists(sessionId) AND answerAudio.#id.#key = :key AND contains(acceptedAnswerIds, :turn) AND (attribute_not_exists(answerAudioClosed) OR answerAudioClosed = :open) AND (attribute_not_exists(answerAudio.#id.#status) OR answerAudio.#id.#status = :pending OR (answerAudio.#id.#status = :processing AND answerAudio.#id.processingExpiresAt < :now)) AND (attribute_not_exists(answerAudio.#id.processingAttempts) OR answerAudio.#id.processingAttempts < :limit)',
   ExpressionAttributeNames:{'#id':id,'#status':'status','#key':'key'},
   ExpressionAttributeValues:{':key':key,':turn':entry.clientTurnId,':open':false,':pending':'PENDING',':processing':'PROCESSING',':owner':owner,':expiry':now+75000,':now':now,':limit':3,':zero':0,':one':1}}),s.userId);
 }catch(e){if(e.name==='ConditionalCheckFailedException')return;if(e.code==='ACCOUNT_DELETING'){await remove([key]);return;}throw e;}
 let durationSeconds,delivery;
 try {
  const object=await sendBounded(client,new GetObjectCommand({Bucket:bucket(),Key:key}));
  if(object.ContentLength!==entry.fileSize||object.ContentLength>MAX_BYTES){object.Body?.destroy?.();throw error('INVALID_WAV');}
  // Enforce a stream bound too, independently of the advisory response header.
  const parts=[];let size=0;
  try {for await(const part of streamBounded(object.Body,{maxBytes:entry.fileSize,label:'answerAudioRead'})){size+=part.length;parts.push(part);}}
  catch(e){if(size>entry.fileSize||e.message==='answerAudioRead exceeds byte limit')throw error('INVALID_WAV');throw e;}
  const bytes=Buffer.concat(parts);durationSeconds=wavDuration(bytes);
  if(createHash('sha256').update(bytes).digest('hex')!==entry.sha256)throw error('INVALID_WAV');
  // Object-created processing is separate from input acceptance/question generation.
  // Preserve duration/content feedback if CPU analysis is unavailable.
  try {delivery=await require('./deliveryAnalysis').analyze(bytes,entry.captureSegments);}
  catch(_) {delivery={detector:'silero-v5',status:'UNAVAILABLE',reason:'DELIVERY_ANALYSIS_UNAVAILABLE',limitations:[]};}
 }catch(e){
  if(e.code!=='INVALID_WAV') {
   // Let a bounded S3 retry acquire immediately; a process crash uses expiry.
   try {await ddb.fencedSend(new UpdateCommand({TableName:table(),Key:{sessionId},
    UpdateExpression:'SET answerAudio.#id.#status = :pending REMOVE answerAudio.#id.processingOwner, answerAudio.#id.processingExpiresAt',
    ConditionExpression:'answerAudio.#id.processingOwner = :owner AND answerAudio.#id.#status = :processing',
    ExpressionAttributeNames:{'#id':id,'#status':'status'},ExpressionAttributeValues:{':owner':owner,':processing':'PROCESSING',':pending':'PENDING'}}),s.userId);}catch(_){}
   throw e;
  }
  await remove([key]);durationSeconds=null;
 }
 try {
  await ddb.fencedSend(new UpdateCommand({TableName:table(),Key:{sessionId},
   UpdateExpression:(durationSeconds===null?'SET answerAudio.#id.#status = :status':'SET answerAudio.#id.#status = :status, answerAudio.#id.durationSeconds = :seconds, answerAudio.#id.delivery = :delivery')+' REMOVE answerAudio.#id.processingOwner, answerAudio.#id.processingExpiresAt',
   ConditionExpression:'attribute_exists(sessionId) AND answerAudio.#id.#key = :key AND answerAudio.#id.processingOwner = :owner AND answerAudio.#id.#status = :processing AND (attribute_not_exists(answerAudioClosed) OR answerAudioClosed = :open)',
   ExpressionAttributeNames:{'#id':id,'#status':'status','#key':'key'},
   ExpressionAttributeValues:{':key':key,':owner':owner,':processing':'PROCESSING',':open':false,':status':durationSeconds===null?'INVALID':'READY',...(durationSeconds===null?{}:{':seconds':durationSeconds,':delivery':delivery})}}),s.userId);
 }catch(e){if(e.name==='ConditionalCheckFailedException'||e.code==='ACCOUNT_DELETING'){if(e.code==='ACCOUNT_DELETING'||closed(await read(sessionId)))await remove([key]);return;}throw e;}
 // Close may win immediately after the READY write. S3 delivery is at least once.
 if(closed(await read(sessionId)))await remove([key]);
}
async function purge(sessionId){
 if(!bucket())return;
 let token;
 do {
  const page=await sendBounded(client,new ListObjectsV2Command({Bucket:bucket(),Prefix:`answers/${sessionId}/`,ContinuationToken:token,MaxKeys:100}));
  await remove((page.Contents||[]).map(o=>o.Key));token=page.IsTruncated?page.NextContinuationToken:null;
  if(page.IsTruncated&&!token)throw error('AUDIO_PAGINATION_FAILED');
 }while(token);
}
async function close(s){
 if(!bucket()||!s?.answerAudio)return;
 await ddb.fencedSend(new UpdateCommand({TableName:table(),Key:{sessionId:s.sessionId},
  UpdateExpression:'SET answerAudioClosed = :yes, answerAudioCleanupPending = :yes',
  ConditionExpression:'attribute_exists(sessionId)',ExpressionAttributeValues:{':yes':true}}),s.userId);
 await cleanup(s);
}
async function cleanup(s){
 await purge(s.sessionId);
 // A signed POST can still be used for 60s. Keep re-purging through that window;
 // object-created delivery and the bucket's expiry protect still later arrivals.
 if(Date.now()>(s.answerAudioLastExpiry||0)+90000){
  await ddb.fencedSend(new UpdateCommand({TableName:table(),Key:{sessionId:s.sessionId},
   UpdateExpression:'SET answerAudioCleanupPending = :no REMOVE answerAudio',
   ConditionExpression:'answerAudioClosed = :yes',ExpressionAttributeValues:{':yes':true,':no':false}}),s.userId);
 }
}
function measurements(s,rows){
 const ids=s.acceptedAnswerIds||[];
 const answers=ids.map((id,index)=>{
  const entry=s.answerAudio?.[idFor(id)];
  const text=rows.find(r=>r.speaker==='USER'&&r.eventId===id)?.text;
  const seconds=entry?.status==='READY'&&Number.isFinite(entry.durationSeconds)&&entry.durationSeconds>0?entry.durationSeconds:null;
  const words=typeof text==='string'?text.trim().split(/\s+/).filter(Boolean).length:null;
  return {answerNumber:index+1,recordingSeconds:seconds,recognizedWords:words,
   recognizedWordsPerMinute:seconds&&words!==null?Math.round(words*60/seconds):null,
   ...(entry?.delivery?{delivery:entry.delivery}:{}),
   recognizedWordsPerResponseMinute:entry?.delivery?.status==='AVAILABLE'&&entry.delivery.responseWindowSeconds>0&&words!==null?Math.round(words*60/entry.delivery.responseWindowSeconds):null,
   ...require('./deliveryAnalysis').transcriptMarkers(text),
   ...(seconds?{}:{unavailableReason:entry?.status==='INVALID'?'INVALID_RECORDING':entry?'UPLOAD_INCOMPLETE':'NOT_RECORDED'})};
 });
 return {version:2,answers,note:'Delivery steadiness uses detected speech and internal pauses of at least 0.5 seconds. Leading/trailing silence and capture gaps are excluded from the response window. Pace and filler/repeated-word counts use recognized text and may reflect recognition errors. Recording contrast is not a calibrated noise measurement. These measurements are not confidence, fluency or pronunciation scores.'};
}
async function collect(s){
 // Regeneration can reuse persisted objective values after raw files are gone.
 if(s.answerAudioClosed&&s.deliveryMeasurements)return s.deliveryMeasurements;
 if(!bucket()||!(s.answerAudioExpectedIds||[]).length)return undefined;
 // Feedback admission is an independent recovery boundary for a worker that
 // crashed after claiming an uploaded object. Never replay READY measurements.
 for(const entry of Object.values(s.answerAudio||{})) {
  if(entry.status==='PROCESSING'&&entry.processingExpiresAt<Date.now()&&(entry.processingAttempts||0)<3&&!closed(s)) {
   try {await arrived({bucket:bucket(),key:entry.key});}catch(_){}
  }
 }
 const deadline=Date.now()+10000;let live=s;
 while((live.answerAudioExpectedIds||[]).some(id=>!['READY','INVALID'].includes(live.answerAudio?.[idFor(id)]?.status))&&Date.now()<deadline&&remaining()>5000&&!closed(live)){
  await new Promise(r=>setTimeout(r,500));live=await read(s.sessionId);if(!live||live.userId!==s.userId)return undefined;
 }
 const rows=await require('../models/transcript').getTranscriptBySession(s.sessionId);
 return measurements(live,rows);
}
module.exports={reserve,read,arrived,purge,close,cleanup,collect,measurements,wavDuration,idFor,MAX_BYTES,closed};

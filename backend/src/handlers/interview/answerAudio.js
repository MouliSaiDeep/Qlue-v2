const audio=require('../../lib/answerAudio');
async function handle(event){
 if(event.Records){for(const record of event.Records){if(record.s3)await audio.arrived({bucket:record.s3.bucket.name,key:decodeURIComponent(record.s3.object.key.replace(/\+/g,' '))});}return {success:true};}
 const uid=event.requestContext?.authorizer?.uid;
 if(!uid)return {statusCode:401,body:JSON.stringify({code:'UNAUTHORIZED'})};
 try{
  const body=JSON.parse(event.body||'{}');
  if(typeof body.sessionId!=='string'||!(/^[a-zA-Z0-9-]{1,80}$/.test(body.sessionId)))return {statusCode:400,body:JSON.stringify({code:'INVALID_SESSION'})};
  const s=await audio.read(body.sessionId);if(!s)return {statusCode:404,body:JSON.stringify({code:'NOT_FOUND'})};
  const result=await audio.reserve(s,uid,body);
  return {statusCode:200,body:JSON.stringify(result)};
 }catch(e){const code=e.code||e.name;return {statusCode:code==='FORBIDDEN'?403:['ANSWER_PENDING','AUDIO_CLOSED','ACCOUNT_DELETING','AUDIO_CHANGED','ConditionalCheckFailedException'].includes(code)?409:code==='INVALID_AUDIO'||e instanceof SyntaxError?400:500,body:JSON.stringify({code:['FORBIDDEN','ANSWER_PENDING','AUDIO_CLOSED','ACCOUNT_DELETING','AUDIO_CHANGED','INVALID_AUDIO'].includes(code)?code:'AUDIO_UNAVAILABLE'})};}
}
exports.handler=(event,context)=>require('../../lib/deadline').withDeadline(context,()=>handle(event),{maxMs:event.Records?55000:9000,userId:event.requestContext?.authorizer?.uid});

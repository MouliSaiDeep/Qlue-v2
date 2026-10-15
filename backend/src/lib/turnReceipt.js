const { GetCommand }=require('@aws-sdk/lib-dynamodb');
const { createHash }=require('node:crypto');
const table=()=>process.env.TRANSCRIPTS_TABLE||'qlue-transcripts';
const key=(sessionId,id)=>`REQUEST#${sessionId}#${id}`;
function fingerprint(body){return createHash('sha256').update(JSON.stringify([body.textTranscript||'',!!body.isSilence,body.currentConceptId||null])).digest('hex');}
async function get(sessionId,id){const {docClient}=require('./dynamodb');const res=await require('./deadline').sendBounded(docClient,new GetCommand({TableName:table(),Key:{transcriptId:key(sessionId,id)},ConsistentRead:true}));return res.Item;}
function put(sessionId,id,body,job,userId){return {Put:{TableName:table(),Item:{transcriptId:key(sessionId,id),userId,requestSessionId:sessionId,fingerprint:fingerprint(body),job},ConditionExpression:'attribute_not_exists(transcriptId)'}};}
module.exports={get,put,fingerprint};

// The accepted answer manifest, not a count of received USER rows, owns grading.
const {createHash}=require('node:crypto');
const {compareTranscripts}=require('../models/transcript');
function select(session, rows) {
 const ordered=rows.slice().sort(compareTranscripts),unique=new Map();
 for(const row of ordered){
  const speaker=String(row.speaker||'').toUpperCase();
  const identity=row.eventId||row.transcriptId||createHash('sha256').update(JSON.stringify([row.turnIndex,speaker,row.text])).digest('hex');
  const key=`${speaker}:${identity}`;
  if(unique.has(key)&&unique.get(key).text!==row.text)throw Error('Conflicting transcript identity');
  if(!unique.has(key))unique.set(key,{...row,speaker,eventId:identity});
 }
 const all=[...unique.values()],ids=new Set(session.acceptedAnswerIds||[]);
 const users=all.filter(r=>r.speaker==='USER');
 if([...ids].some(id=>!users.some(r=>r.eventId===id)))throw Error('Accepted transcript index has not caught up');
 const identityContract=session.answerIdentityVersion===1;
 if(identityContract&&session.answeredCount!==ids.size)throw Error('Accepted answer manifest is incomplete');
 const legacy=!identityContract&&(!ids.size||(session.answeredCount||0)>ids.size);
 const {isClarification,detectExitIntent}=require('../handlers/interview/processUserInput');
 const legacyAnswer=r=>typeof r.text==='string'&&r.text.trim().length>0&&!isClarification(r.text)&&!detectExitIntent(r.text)
   &&(!['INTRO','SELF_INTRO'].includes(session.moduleType)||r.text.trim().split(/\s+/).length>1);
 const answers=users.filter(r=>ids.has(r.eventId)||(legacy&&legacyAnswer(r)));
 if(legacy&&Number.isFinite(session.answeredCount)&&answers.length<session.answeredCount)throw Error('Legacy transcript index has not caught up');
 const selected=new Set(answers),contexts=[];
 for(const answer of answers){
  const question=all.slice(0,all.indexOf(answer)).reverse().find(r=>r.speaker==='AI');
  if(question)selected.add(question);
  contexts.push({answerId:answer.eventId,questionId:question?.eventId||null,turnIndex:answer.turnIndex});
 }
 return {rows:all.filter(r=>selected.has(r)),answers:contexts,legacy};
}
function assessmentContext(session){
 // Only the strongly read, owned session's immutable init snapshot is trusted.
 const data=session.itemData||{};
 if(session.moduleType==='JD')return typeof data.jdSummary==='string'&&data.jdSummary.trim()
   ? {kind:'JOB',text:data.jdSummary.slice(0,6000),role:data.jdRoleTitle||'',digest:data.jdDigest||null}:null;
 if(session.moduleType==='WEBSITE')return typeof data.scrapedSummary==='string'&&data.scrapedSummary.trim()
   ? {kind:'SOURCE',text:data.scrapedSummary.slice(0,6000),topic:data.targetConcept||''}:null;
 return null;
}
module.exports={select,assessmentContext};

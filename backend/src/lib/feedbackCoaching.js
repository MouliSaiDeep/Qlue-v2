'use strict';
const VERSION='answer-specific-v2';
const fields=['criterionId','answerId','evidenceId','strength','gap','nextStep','reason'];
const schema={type:'object',properties:{summary:{type:'string'},criteria:{type:'array',items:{type:'object',
 properties:Object.fromEntries(fields.map(k=>[k,{type:'string'}])),required:fields,additionalProperties:false}}},required:['summary','criteria'],additionalProperties:false};
function schemaFor(rubric) {
 const entryFields=fields.filter(k=>k!=='criterionId');
 const entry={type:'object',properties:Object.fromEntries(entryFields.map(k=>[k,{type:'string'}])),required:entryFields,additionalProperties:false};
 return {...schema,properties:{summary:{type:'string'},criteria:{type:'object',properties:Object.fromEntries(rubric.map(r=>[r.id,entry])),required:rubric.map(r=>r.id),additionalProperties:false}}};
}
const fail=()=>{throw new (require('./feedbackAssessment').InvalidAssessment)('INVALID_COACHING');};
const bland=/^(?:great effort(?: in completing the session)?|you (?:have )?completed (?:the|your) (?:interview|session)|this is (?:the )?main problem|keep practi[sc]ing)[.!\s]*$/i;
function text(value,max,empty=false) {
 if(typeof value!=='string'||value.length>max||(!empty&&!value.trim())||bland.test(value.trim()))fail();
 return value.trim();
}
function shape(value,rubric,answerIds,resolved=false) {
 if(!value||Object.keys(value).sort().join()!=='criteria,summary'||!Array.isArray(value.criteria)||value.criteria.length!==rubric.length)fail();
 const seen=new Set(),summary=text(value.summary,1200);
 if(summary.length<50)fail();
 if(/\b(?:both|two|different|first|second) candidates?\b|\bcandidates\b/i.test(summary))fail();
 const criteria=value.criteria.map(c=>{
  if(!c||Object.keys(c).sort().join()!==[...fields,...(resolved?['evidence']:[])].sort().join()||!rubric.some(r=>r.id===c.criterionId)||seen.has(c.criterionId)||!answerIds.has(c.answerId))fail();
  seen.add(c.criterionId);
  const result={criterionId:c.criterionId,answerId:c.answerId,evidenceId:text(c.evidenceId,12,true),strength:text(c.strength,350,true),gap:text(c.gap,350,true),nextStep:text(c.nextStep,350,true),reason:text(c.reason,500)};
  if(!result.nextStep&&/^(?:no (?:meaningful|significant|major) gap|none\b|not applicable\b)/i.test(result.gap))result.gap='';
  if(Boolean(result.gap)!==Boolean(result.nextStep)||result.reason.length<15)fail();
  if(/uncertain audio|recognition (?:error|confidence)|transcription (?:error|confidence)/i.test(result.gap))fail();
  if(resolved)result.evidence=text(c.evidence,240,true);
  return result;
 });
 return {summary,criteria:rubric.map(r=>criteria.find(c=>c.criterionId===r.id))};
}
function validate(value,prepared,results) {
 if(value?.criteria&&!Array.isArray(value.criteria)&&typeof value.criteria==='object')value={...value,criteria:Object.entries(value.criteria).map(([criterionId,c])=>({...c,criterionId}))};
 const graded=prepared.module==='INTRO'?[results.at(-1)]:results;
 const result=shape(value,prepared.rubric,new Set(graded.map(a=>a.answerId)));
 for(const c of result.criteria){
  const input=prepared.answers.find(a=>a.answerId===c.answerId),segment=input.segments.find(s=>s.id===c.evidenceId);
  if(c.evidenceId===''){
    // Missing support can be described honestly without inventing a quote.
    if(!c.gap)fail();c.strength='';c.evidence='';
  }else{
    if(!segment||!require('./feedbackAssessment').meaningfulEvidence(segment.text)||segment.text.includes('[uncertain audio]')||!input.text.includes(segment.text))fail();
    c.evidence=segment.text;
  }
  const i=prepared.rubric.findIndex(r=>r.id===c.criterionId);
  if(graded.every(a=>a.levels[i]===4)){c.gap='';c.nextStep='';}
  if(c.criterionId==='clarity'&&/\b(?:filler|fillers|accent|accents|uh|umms|ahhs|hesitation|hesitations|disfluency|disfluencies)\b/i.test(c.gap+' '+c.nextStep)){c.gap='';c.nextStep='';}
  if(graded.reduce((sum,a)=>sum+a.levels[i],0)/graded.length<3&&!c.gap)fail();
 }
 // Retain the model's narrative summary even when all criteria are met. Joining
 // the strengths here used to turn every maximum-score summary into repetition.
 return result;
}
function verify(value,answers,rubric,module) {
 return shape(value,rubric,new Set((module==='INTRO'?[answers.at(-1)]:answers).map(a=>a.answerId)),true);
}
const stop=new Set('about after also answer answers actually candidate concrete details does done each explain explanation have implementation implemented lack lacks missing more need needs personal provide response responses specific technical that their there these they this through what when which while with without would your'.split(' '));
const tokens=value=>new Set((value.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu)||[]).filter(w=>!stop.has(w)).map(w=>w.replace(/(?:ations|ation|ments|ment|ing|ized|ised|tion|ions|ies|ed|s)$/,'')));
function distinct(items) {
 const result=[];
 for(const value of items.filter(Boolean)){
  const words=tokens(value);
  if(!result.some(previous=>{
   const other=tokens(previous),common=[...words].filter(w=>other.has(w)).length;
   return previous.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,'')===value.toLowerCase().replace(/[^\p{L}\p{N}\s]/gu,'')||(common>=3&&common/Math.max(1,Math.min(words.size,other.size))>=.65);
  }))result.push(value);
 }
 return result.slice(0,3);
}
function enrich(report,coaching) {
 const byId=new Map(coaching.criteria.map(c=>[c.criterionId,c]));
 report.strengths=distinct(coaching.criteria.map(c=>c.strength));
 report.weaknesses=distinct(coaching.criteria.map(c=>c.gap));
 report.recommendations=distinct(coaching.criteria.map(c=>c.nextStep));
 report.executiveSummary=coaching.summary;
 report.scoreExplanations=report.assessment.rubric.map((r,i)=>{
  const c=byId.get(r.id);
  const reason=report.assessment.scope==='FINAL_INTRODUCTION'?report.assessment.answers.at(-1).reasons?.[i]||c.reason:c.reason;
  return {id:r.id,label:r.label,weight:r.weight,score:report.dimensionScores[r.label],reason,
   evidence:c.evidence?[{answerId:c.answerId,quote:c.evidence}]:[],improvement:c.nextStep};
 });
 report.assessment.coachingVersion=VERSION;report.assessment.coaching=coaching;
 return report;
}
module.exports={VERSION,schema,schemaFor,validate,verify,enrich,distinct};

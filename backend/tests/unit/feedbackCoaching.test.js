const a=require('../../src/lib/feedbackAssessment'),c=require('../../src/lib/feedbackCoaching');
const fixture=require('../helpers/coachingFixture');
const prepare=()=>a.prepare({moduleType:'INTRO',answerPairs:[{answerId:'baseline',question:'Introduce yourself.',answer:'I am a student.'},{answerId:'a',question:'Describe your project.',answer:'I built an API for practice. I tested its authentication.'}]});
const output=()=>({coaching:fixture('a',true),answers:[{answerId:'baseline',levels:[1,1,1,2],evidenceIds:Array(4).fill('e1')},{answerId:'a',levels:[3,2,3,4],evidenceIds:Array(4).fill('e1')}]});
test('specific strengths can be recognized below a perfect grade; every dimension has a grounded explanation',()=>{
 const p=prepare(),o=output();o.coaching.criteria[1].gap='Your API example does not explain the result of the authentication tests.';o.coaching.criteria[1].nextStep='Explain one authentication test and what it demonstrated.';
 const r=a.report(p,a.validate(JSON.stringify(o),p,{requireCoaching:true}));
 expect(r.assessment.practiceProgress.baseline).toBe(28.8);
 expect(r.strengths).toContain('You describe building and testing a relevant API project.');
 expect(r.weaknesses).toEqual([o.coaching.criteria[1].gap]);
 expect(r.scoreExplanations).toHaveLength(4);expect(r.scoreExplanations[1]).toMatchObject({label:'Specific Evidence',score:50,weight:30,improvement:o.coaching.criteria[1].nextStep});
 expect(r.scoreExplanations.every(e=>e.evidence[0].quote==='I built an API for practice.')).toBe(true);
 expect(a.verifyReport(r,'INTRO')).toEqual(r);
});
test('foreign, baseline, missing and unknown-audio coaching references cannot become advice',()=>{
 for(const patch of [{answerId:'foreign'},{answerId:'baseline'},{evidenceId:'e999'},{evidenceId:'[uncertain audio]'}]){
  const o=output();Object.assign(o.coaching.criteria[0],patch);
  expect(()=>a.validate(JSON.stringify(o),prepare(),{requireCoaching:true})).toThrow('INVALID_COACHING');
 }
});
test('missing coaching cannot silently restore generic template prose in the production path',()=>{
 const o=output();delete o.coaching;
 expect(()=>a.validate(JSON.stringify(o),prepare(),{requireCoaching:true})).toThrow('COACHING_MISSING');
});
test('completion praise, duplicate criteria and unactionable gaps are rejected',()=>{
 for(const mutate of [o=>o.coaching.criteria[0].strength='Great effort in completing the session.',o=>o.coaching.criteria[1].criterionId='relevance',o=>o.coaching.criteria[0].gap='Explain your project.']){
  const o=output();mutate(o);expect(()=>a.validate(JSON.stringify(o),prepare(),{requireCoaching:true})).toThrow('INVALID_COACHING');
 }
});
test('repeated coaching points are grouped without forcing score variation',()=>{
 expect(c.distinct(['Explain your personal contribution to the API project.','Explain your personal contribution to the API project!','Add a clear closing about your goal.'])).toHaveLength(2);
 const o=output();o.answers[1].levels=[3,3,3,3];expect(a.report(prepare(),a.validate(JSON.stringify(o),prepare())).overallScore).toBe(75);
});
test('keyed criterion reasons survive canonical storage and an omitted ungraded baseline never becomes zero progress',()=>{
 const p=prepare(),o=output();
 o.answers=o.answers.slice(1).map(answer=>({answerId:answer.answerId,criteria:Object.fromEntries(p.rubric.map((r,i)=>[r.id,{reason:o.coaching.criteria[i].reason,evidenceId:'e1',level:answer.levels[i],...(r.id==='evidence'?{actionDetailId:'',outcomeId:''}:{})}]))}));
 o.coaching.criteria=Object.fromEntries(o.coaching.criteria.map(({criterionId,...c})=>[criterionId,c]));
 const r=a.report(p,a.validate(JSON.stringify(o),p,{requireCoaching:true}));
 expect(r.assessment.practiceProgress).toBeUndefined();expect(r.assessment.practiceProgressUnavailable).toBe(true);
 expect(r.assessment.answers).toHaveLength(1);expect(r.scoreExplanations[0].reason).toBe(o.coaching.criteria.relevance.reason);
 expect(a.verifyReport(r,'INTRO')).toEqual(r);
});
test('fully met criteria do not manufacture leadership requirements or gaps to fill the report',()=>{
 const p=prepare(),o=output();o.answers[1].levels=[4,4,4,4];
 const r=a.report(p,a.validate(JSON.stringify(o),p));expect(r.weaknesses).toEqual([]);expect(r.recommendations).toEqual([]);
 expect(r.executiveSummary).not.toContain('result of');
});

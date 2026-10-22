const assessment=require('../../src/lib/feedbackAssessment');
const coaching=require('../../src/lib/feedbackCoaching');
const {isNameCorrection}=require('../../src/lib/conversationRepair');
const correction='Sorry, you, I think you have heard my name in a wrong way. My name is Rishi. OK.';
test.each([correction,'Sorry, you got my name wrong. My name is Rishi.','My name is Rishi, not Rashid.'])('explicit name repair is control: %s',value=>expect(isNameCorrection(value)).toBe(true));
test.each(['My name is Rishi.','Sorry, my name is Rishi and I built a reconnecting WebSocket client.','You got my name wrong. My name is Rishi. I implemented JSON serialization.','The project corrects names using a lookup.'])('mixed and ordinary answers remain scored: %s',value=>expect(isNameCorrection(value)).toBe(false));
test('already accepted name corrections are retained in audit metadata and excluded before grading',()=>{
 const prepared=assessment.prepare({moduleType:'RESUME',answerPairs:[
  {answerId:'repair',question:'Explain your WebSocket implementation.',answer:correction},
  {answerId:'technical',question:'Explain your WebSocket implementation.',answer:'I implemented reconnect backoff and idempotent message IDs.'}
 ]});
 expect(prepared.answers.map(a=>a.answerId)).toEqual(['technical']);
 expect(prepared.input.gradedAnswerIds).toEqual(['technical']);
 expect(prepared.excludedAnswers).toEqual([{answerId:'repair',reason:'NAME_CORRECTION'}]);
});
test('correction-only input receives no invented score',()=>expect(()=>assessment.prepare({moduleType:'RESUME',answerPairs:[{answerId:'repair',question:'Describe your project.',answer:correction}]})).toThrow('INPUT_UNAVAILABLE'));
test('recognition fragments cannot be selected as score evidence',()=>{
 const p=assessment.prepare({moduleType:'INTRO',answerPairs:[{answerId:'a',question:'Introduce yourself.',answer:'I built a tested interview screen. I. Yeah OK.'}]});
 expect(p.answers[0].segments.filter(s=>s.id).map(s=>s.text)).toEqual(['I built a tested interview screen.']);
});
test('a balanced maximum-score summary survives instead of becoming concatenated strengths',()=>{
 const p=assessment.prepare({moduleType:'INTRO',answerPairs:[{answerId:'a',question:'Introduce yourself.',answer:'I built an API for practice. I tested its authentication.'}]});
 const fixture=require('../helpers/coachingFixture')('a');
 const r=assessment.report(p,assessment.validate(JSON.stringify({answers:[{answerId:'a',levels:[4,4,4,4],evidenceIds:Array(4).fill('e1')}],coaching:fixture}),p));
 expect(r.executiveSummary).toBe(fixture.summary);
 const unordered=structuredClone(r);unordered.dimensionScores=Object.fromEntries(Object.entries(r.dimensionScores).reverse());
 expect(assessment.verifyReport(unordered,'INTRO').overallScore).toBe(100);
});
test('same implementation gap is not repeated under different wording',()=>{
 expect(coaching.distinct([
  'No technical explanation of how connection management, serialization, or synchronization was implemented.',
  'No concrete details about what was actually done in connection management, serialization, or synchronization.',
  'Connect the project to your own role.'
 ])).toHaveLength(2);
});
test('clarity advice cannot penalize fillers excluded by the rubric',()=>{
 const p=assessment.prepare({moduleType:'INTRO',answerPairs:[{answerId:'a',question:'Introduce yourself.',answer:'I built an API for practice.'}]});
 const fixture=require('../helpers/coachingFixture')('a');fixture.criteria[3].gap='Frequent filler words reduce clarity.';fixture.criteria[3].nextStep='Reduce filler words.';
 const report=assessment.report(p,assessment.validate(JSON.stringify({answers:[{answerId:'a',levels:[4,4,4,3],evidenceIds:Array(4).fill('e1')}],coaching:fixture}),p));
 expect(report.weaknesses.join(' ')).not.toMatch(/filler/i);
 expect(report.recommendations.join(' ')).not.toMatch(/filler/i);
});
test('a maximum introduction evidence grade requires separate support for a specific action and outcome',()=>{
 const p=assessment.prepare({moduleType:'INTRO',answerPairs:[{answerId:'a',question:'Introduce yourself.',answer:'I developed the backend of the interview screens. We placed in a project event.'}]});
 const criteria=Object.fromEntries(p.rubric.map(c=>[c.id,{reason:'The answer provides relevant background and project details.',evidenceId:'e1',level:4,...(c.id==='evidence'?{actionDetailId:'',outcomeId:'e2'}:{})}]));
 expect(()=>assessment.validate(JSON.stringify({answers:[{answerId:'a',criteria}]}),p)).toThrow('UNSUPPORTED_MAXIMUM_EVIDENCE');
});
test('a summary cannot mistake multiple answers for multiple candidates',()=>{
 const p=assessment.prepare({moduleType:'INTRO',answerPairs:[{answerId:'a',question:'Introduce yourself.',answer:'I built an API for practice.'}]});
 const fixture=require('../helpers/coachingFixture')('a');fixture.summary='Both candidates describe building an API for practice and demonstrate their project experience.';
 expect(()=>assessment.validate(JSON.stringify({answers:[{answerId:'a',levels:[4,4,4,4],evidenceIds:Array(4).fill('e1')}],coaching:fixture}),p)).toThrow('INVALID_COACHING');
});

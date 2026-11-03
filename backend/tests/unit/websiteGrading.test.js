const g=require('../../src/lib/websiteGradingGuide'),assessment=require('../../src/lib/feedbackAssessment');
const question='Explain acknowledgments, retransmission and their limitations.';
const source='TCP uses sequence numbers, acknowledgments and retransmission to provide reliable ordered delivery. Loss recovery can increase delay.';
const rawGuide={points:{p1:{sourceId:'s1',kind:'FACT'},
 p2:{sourceId:'s2',kind:'RELATIONSHIP'},p3:{sourceId:'',kind:'FACT'},p4:{sourceId:'',kind:'FACT'}}};
const invoke=()=>jest.fn(async()=>({content:[{text:JSON.stringify(rawGuide)}]}));
const answer='TCP acknowledges received bytes and retransmits data after loss. Sequence numbers identify duplicates. Reliable ordered delivery can take longer during loss recovery.';
async function prepare(q=question,s=source){const guide=await g.create(q,s,invoke());return assessment.prepare({moduleType:'WEBSITE',assessmentContext:{kind:'SOURCE',text:s},
 answerPairs:[{answerId:'a',question:q,answer,websiteGradingGuide:guide}]});}
const check=(status='SUPPORTED',evidenceId='e1')=>({status,evidenceId,reason:'The answer directly conveys the fact required by the saved source guide.'});
const response=p=>({websiteChecks:{answer_1:{points:Object.fromEntries(p.answers[0].websiteGradingGuide.points.map(x=>[x.id,check()])),clarity:{...check(),status:'CLEAR'},
 ...(p.answers[0].websiteGradingGuide.applicationRequested?{application:check()}: {})}}});

test('guide generation is candidate blind, exactly grounded and bound to question/source versions',async()=>{
 const model=invoke(),guide=await g.create(question,source,model);
 const sent=JSON.stringify(model.mock.calls[0]);expect(sent).not.toContain(answer);
 expect(g.validate(guide,question,source)).toBe(guide);
 expect(()=>g.validate(guide,'Different question',source)).toThrow('WEBSITE_GUIDE_UNAVAILABLE');
 expect(()=>g.validate(guide,question,source+' Changed.')).toThrow('WEBSITE_GUIDE_UNAVAILABLE');
 const bad=jest.fn(async()=>({content:[{text:JSON.stringify({points:{...rawGuide.points,p1:{sourceId:'s999',kind:'FACT'}}})}]}));
 await expect(g.create(question,source,bad)).rejects.toThrow('WEBSITE_GUIDE_UNAVAILABLE');
});

test('saved factual coverage gives deterministic marks without demanding unasked examples',async()=>{
 const p=await prepare(),raw=response(p);
 const one=assessment.report(p,assessment.validate(JSON.stringify(raw),p,{requireCoaching:true}));
 raw.websiteChecks.answer_1.points.p1.reason='This reason is phrased differently but checks the same supplied evidence.';
 const two=assessment.report(p,assessment.validate(JSON.stringify(raw),p,{requireCoaching:true}));
 expect(one.overallScore).toBe(100);expect(two.overallScore).toBe(one.overallScore);
 expect(one.assessment.answers[0].levels).toEqual([4,4,4,4]);
 expect(one.assessment.websiteChecks[0]).toMatchObject({answerId:'a',guideVersion:g.VERSION});
 expect(assessment.verifyReport(one,'WEBSITE').overallScore).toBe(100);
 expect(JSON.stringify(one.weaknesses)).not.toContain('example');
});

test('guide audit identity survives DynamoDB map key reordering',async()=>{
 const p=await prepare(),guide=p.answers[0].websiteGradingGuide;
 const reordered=Object.fromEntries(Object.entries(guide).reverse());
 reordered.points=guide.points.map(point=>Object.fromEntries(Object.entries(point).reverse()));
 expect(g.validate(reordered,question,source)).toEqual(guide);
 expect(g.digest(reordered)).toBe(g.digest(guide));
 const report=assessment.report(p,assessment.validate(JSON.stringify(response(p)),p));
 expect(report.assessment.websiteChecks[0].guideSha256).toBe(g.digest(reordered));
});

test('model input is byte-identical after the saved guide passes through a reordered DynamoDB map',async()=>{
 const p=await prepare(),first=assessment.prompt(p),original=p.answers[0].websiteGradingGuide;
 const reordered=Object.fromEntries(Object.entries(original).reverse());
 reordered.points=original.points.map(point=>Object.fromEntries(Object.entries(point).reverse()));
 p.answers[0].websiteGradingGuide=reordered;
 expect(assessment.prompt(p)).toEqual(first);
 expect(JSON.stringify(assessment.prompt(p))).toBe(JSON.stringify(first));
});

test('missing required relationship lowers the correct dimensions without a clarity penalty',async()=>{
 const p=await prepare(),raw=response(p);raw.websiteChecks.answer_1.points.p2=check('MISSING','');
 const r=assessment.report(p,assessment.validate(JSON.stringify(raw),p));
 expect(r.assessment.answers[0].levels).toEqual([2,2,0,4]);expect(r.overallScore).toBe(47.5);
 expect(r.assessment.coachingVersion).toBeDefined();
});

test('compact factual checks preserve marks and derive grounded explanations without model prose',async()=>{
 const p=await prepare(),raw=response(p),slot=raw.websiteChecks.answer_1;
 for(const c of [...Object.values(slot.points),slot.clarity])delete c.reason;
 slot.points.p2.status='PARTIAL';
 const result=assessment.report(p,assessment.validate(JSON.stringify(raw),p,{requireCoaching:true}));
 expect(result.assessment.answers[0].levels).toEqual([3,3,2,4]);
 expect(result.scoreExplanations[0].reason).toContain(p.answers[0].websiteGradingGuide.points[0].quote);
 expect(result.scoreExplanations[3].reason).toContain('Your meaning is clear');
 expect(assessment.verifyReport(result,'WEBSITE').overallScore).toBe(result.overallScore);
});

test('a requested application is checked explicitly while a definition does not invent one',async()=>{
 const p=await prepare('Apply TCP reliability to an example file-transfer scenario.'),raw=response(p);
 expect(p.answers[0].websiteGradingGuide.applicationRequested).toBe(true);
 raw.websiteChecks.answer_1.application=check('MISSING','');
 const r=assessment.validate(JSON.stringify(raw),p);expect(r[0].levels[1]).toBe(0);
});

test.each(['invented-evidence','missing-slot','extra-point','freeform-grade'])('untrusted checks fail closed: %s',async kind=>{
 const p=await prepare(),raw=response(p);
 if(kind==='invented-evidence')raw.websiteChecks.answer_1.points.p1.evidenceId='e999';
 if(kind==='missing-slot')delete raw.websiteChecks.answer_1;
 if(kind==='extra-point')raw.websiteChecks.answer_1.points.p9=check();
 if(kind==='freeform-grade')raw.overallScore=100;
 expect(()=>assessment.validate(JSON.stringify(raw),p)).toThrow();
});

test('AI transcript retains the immutable guide and answer pairing carries it to feedback',async()=>{
 const p=await prepare(),guide=p.answers[0].websiteGradingGuide;
 const transcript=require('../../src/models/transcript').buildTranscript('s',0,'AI',question,{eventId:'q',websiteGradingGuide:guide});
 expect(transcript.websiteGradingGuide).toEqual(guide);
 const pairs=assessment.pairs({rows:[transcript,{speaker:'USER',eventId:'a',text:answer}],answers:[{answerId:'a',questionId:'q'}]});
 expect(pairs[0].websiteGradingGuide).toEqual(guide);
});

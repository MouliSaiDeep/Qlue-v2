// Closed editorial vocabulary. Model-selected topics must be exact evidence substrings.
const {rubricFor}=require('./feedbackRubric');
const TEXT={
 EXAMPLE:t=>t?`Gives a concrete example of ${t}.`:'Gives a concrete example.',
 BACKGROUND:t=>t?`States relevant background in ${t}.`:'States relevant background.',
 ROLE_GOAL:t=>t?`States a career goal involving ${t}.`:'States a career goal.',
 DIRECT_CONTENT:t=>t?`Presents a clear main point about ${t}.`:'Presents a clear main point.',
 LOGICAL_SEQUENCE:t=>t?`Connects background, experience and goals around ${t}.`:'Connects background, experience and goals.',
 TECHNICAL_REASONING:t=>t?`Explains the mechanism behind ${t} with supporting reasoning.`:'Explains a technical mechanism with supporting reasoning.',
 ROLE_LINK:t=>t?`Connects experience with the role requirement ${t}.`:'Connects experience with a role requirement.',
 CONCRETE_EXAMPLE:t=>t?`Describes a specific action or project involving ${t}.`:'Describes a specific action or project.',
 PROBLEM_APPROACH:t=>t?`Connects the problem of ${t} to a solution approach.`:'Connects a problem to a solution approach.',
 REFLECTION:t=>t?`Identifies a lesson learned from ${t}.`:'Identifies a lesson learned from experience.',
 CONCEPT_EXPLANATION:t=>t?`Explains the meaning or mechanism of ${t}.`:'Explains the meaning or mechanism of the concept.',
 REASONED_TRADEOFF:t=>t?`Supports a conclusion about ${t} with a trade-off or limitation.`:'Supports a conclusion with a trade-off or limitation.',
 CONCEPT_APPLICATION:t=>t?`Connects ${t} to an application.`:'Connects a recalled concept to an application.',
 ADD_EXAMPLE:t=>t?`Support ${t} with one specific example.`:'Support the main point with one specific example.',
 ADD_IMPACT:t=>t?`Explain the outcome of ${t}, using a real result where available.`:'Explain the outcome of the example, using a real result where available.',
 ORGANIZE:t=>t?`Organize ${t} into background, experience and goal.`:'Organize the answer into background, experience and goal.',
 EXPLAIN_POINT:t=>t?`Lead with your main point about ${t}, then explain the supporting detail.`:'Lead with your main point, then explain the supporting detail.',
 EXPLAIN_MECHANISM:t=>t?`Explain how ${t} works, including assumptions or limits.`:'Explain how the mechanism works, including assumptions or limits.',
 LINK_ROLE:t=>t?`Connect ${t} to a specific requirement of the role.`:'Connect this experience to a specific role requirement.',
 ACTION_RESULT:t=>t?`Describe your own action and its result in ${t}.`:'Describe your own action and its result in the example.',
 COMPARE_OPTIONS:t=>t?`Compare alternatives for ${t}; explain your choice and how you checked the result.`:'Compare alternatives; explain your choice and how you checked the result.',
 APPLY_LESSON:t=>t?`Explain what ${t} taught you and what you would change next time.`:'Explain the lesson learned and what you would change next time.',
 EXPLAIN_CONCEPT:t=>t?`Explain ${t} in your own words and give an application.`:'Explain the concept in your own words and give an application.',
 TEST_CONCLUSION:t=>t?`State the assumptions behind ${t} and the evidence that would test the conclusion.`:'State the assumptions and evidence that would test the conclusion.',
 RECALL_APPLY:t=>t?`Restate ${t} from memory and apply it to a new example.`:'Restate the concept from memory and apply it to a new example.'
};
const words=text=>text.trim().split(/\s+/).length;
// Extract short source phrases as selectable IDs, rather than asking the model
// to copy constrained text. Every phrase retains its parent exact excerpt.
const connectors=new Set('i am a an the and or but for to of my me it that this at in on with as is are was were have has had want work build built implemented tested taught break into ask improve interested lets see states explains describe describes'.split(' '));
function topics(quote){
 const result=[];let run=[];
 const flush=()=>{if(run.length){const topic=quote.slice(run[0].index,run.at(-1).index+run.at(-1)[0].length);if(topic.length>=2&&topic.length<=60)result.push(topic);}run=[];};
 let previousEnd=0;
 for(const word of quote.matchAll(/[\p{L}\p{N}][\p{L}\p{N}'’-]*/gu)){
  if(/[^\s]/.test(quote.slice(previousEnd,word.index)))flush();
  if(connectors.has(word[0].toLowerCase()))flush();else {run.push(word);if(run.length===4)flush();}
  previousEnd=word.index+word[0].length;
 }flush();return [...new Set(result)];
}
const PRACTICE={
 ADD_EXAMPLE:'Rehearse one example as situation, your action and result; connect it to the question.',
 ADD_IMPACT:'Write your action, who benefited and an observable result. Include real numbers only when available.',
 ORGANIZE:'Write background, project and goal prompts; rehearse one sentence per prompt, then combine them into a short introduction.',
 EXPLAIN_POINT:'Rehearse a short answer: one main point, one supporting detail and one takeaway.',
 EXPLAIN_MECHANISM:'Explain one mechanism through its inputs, steps and output; check the explanation with a test case.',
 LINK_ROLE:'Select one role requirement; pair it with a project, your contribution and the result.',
 ACTION_RESULT:'Rehearse one example as situation, your action and result; distinguish your contribution from the team.',
 COMPARE_OPTIONS:'Write two possible approaches, choose one, and explain a check that would confirm it worked.',
 APPLY_LESSON:'Choose one experience; name your responsibility, a lesson and one change you would make next time.',
 EXPLAIN_CONCEPT:'Explain one concept without your notes, then demonstrate it with a concrete example.',
 TEST_CONCLUSION:'List a claim and its assumptions; compare an alternative and describe evidence that could test it.',
 RECALL_APPLY:'Recall the concept without notes, apply it to a new example, then check against the source.'
};
function topicFor(item,evidence){
 if(item.topic===undefined||item.topic==='')return '';
 if(typeof item.topic!=='string'||item.topic.trim()!==item.topic||item.topic.length<2||item.topic.length>60||words(item.topic)>4||/[\r\n]/.test(item.topic)||!evidence.some(e=>{
  let offset=e.quote.indexOf(item.topic);
  while(offset>=0){const before=e.quote[offset-1]||'',after=e.quote[offset+item.topic.length]||'';
   if(!/[\p{L}\p{N}]/u.test(before)&&!/[\p{L}\p{N}]/u.test(after))return true;
   offset=e.quote.indexOf(item.topic,offset+1);
  }return false;
 }))throw Error('Unsupported topic');
 return item.topic;
}
function finding(criterion,topic){
 const text=TEXT[criterion]?.(topic?`“${topic}”`:'');
 if(!text||words(text)>25)throw Error('Invalid editorial finding');
 return text;
}
function compose(scores,ledger){
 const unique=items=>{const selected=new Map();for(const item of items)if(!selected.has(item.criterion))selected.set(item.criterion,item);return [...selected.values()].slice(0,3);};
 const strengths=unique(ledger.strengths),improvements=unique(ledger.improvements);
 const topics=[...new Set([...strengths,...improvements].map(f=>f.topic).filter(Boolean))].slice(0,2);
 const summary=topics.length
  ? `Your received answers discuss ${topics.map(t=>`“${t}”`).join(' and ')}. The review covers ${Object.keys(scores).join(', ')}.`
  : `Your received answers were assessed for ${Object.keys(scores).join(', ')}. Review the supported findings and exercises below.`;
 const recommendations=[...new Set(improvements.slice(0,2).map(item=>{
 const practice=PRACTICE[item.criterion]||rubricFor(item.dimension).practice;
  const scoped=item.topic?`For “${item.topic}”: ${practice}`:practice;
  // Choose a complete bounded exercise; never truncate a sentence.
  return words(scoped)<=25?scoped:practice;
 }))];
 return {strengths:strengths.map(f=>f.text),improvements:improvements.map(f=>f.text),summary,recommendations};
}
module.exports={topicFor,finding,compose,topics};

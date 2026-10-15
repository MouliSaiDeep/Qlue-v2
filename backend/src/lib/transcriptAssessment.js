// Closed output vocabulary: model prose cannot introduce acoustic judgments or
// invent a personal identity/technology. Quotes must come from USER input.
const MODE = 'TRANSCRIPT_ONLY';
const REASONS = ['INSUFFICIENT_TEXT', 'CORRUPTED_TRANSCRIPT'];
const {FINDINGS,rubricFor} = require('./feedbackRubric');
function userTexts(transcript) {
  if (typeof transcript !== 'string') return [];
  return [...transcript.matchAll(/(?:^|\n\n)USER:\s*([\s\S]*?)(?=\n\n(?:AI|USER|ASSISTANT|UNKNOWN):|$)/g)]
    .map(match => match[1]);
}
// Model responses cite stable IDs rather than copying/escaping customer text.
// Resolve IDs back to exact bounded substrings before the original validator.
function evidenceCatalog(transcript) {
  return userTexts(transcript).flatMap((text,userIndex)=>{
    const excerpts=[];let offset=0;
    while(offset<text.length){
      let end=Math.min(offset+240,text.length);
      if(end<text.length){const space=text.lastIndexOf(' ',end);if(space>offset+120)end=space;}
      const quote=text.slice(offset,end).trim();offset=end;
      if(quote.length>=2)excerpts.push({id:`U${userIndex}E${excerpts.length}`,userIndex,quote});
    }
    return excerpts;
  });
}
function resolveEvidence(item,catalog) {
  if(!Object.hasOwn(item,'evidenceIds'))return item.evidence;
  if(Object.hasOwn(item,'evidence')||!Array.isArray(item.evidenceIds)||item.evidenceIds.length<1||item.evidenceIds.length>3||new Set(item.evidenceIds).size!==item.evidenceIds.length)return null;
  const entries=item.evidenceIds.map(id=>typeof id==='string'?catalog.get(id):undefined);
  return entries.every(Boolean)?entries.map(({userIndex,quote})=>({userIndex,quote})):null;
}
function findingCatalog(transcript){
 const base=evidenceCatalog(transcript),editorial=require('./feedbackEditorial');
 return base.flatMap(entry=>[entry,...editorial.topics(entry.quote).slice(0,8).map((topic,index)=>({...entry,id:`${entry.id}T${index}`,sourceId:entry.id,topic}))]);
}
function evidenceValid(evidence, transcript) {
  const texts = userTexts(transcript);
  return Array.isArray(evidence) && evidence.length > 0 && evidence.length <= 3
    && evidence.every(e => e && Number.isInteger(e.userIndex) && typeof e.quote === 'string'
      && e.quote.trim().length >= 2 && e.quote.length <= 300
      && texts[e.userIndex]?.includes(e.quote));
}
function validateAssessment(parsed, dimensions, transcript) {
  if (parsed?.mode !== MODE || !parsed.dimensions || Array.isArray(parsed.dimensions)) return null;
  const scores = {}, unavailable = {}, evidence = {};
  const catalog=new Map(evidenceCatalog(transcript).map(e=>[e.id,e]));
  for (const dimension of dimensions) {
    if (dimension === 'Confidence') {unavailable[dimension] = 'NO_AUDIO_EVIDENCE';continue;}
    const item = parsed.dimensions[dimension];
    if (!item) return null;
    const resolved=resolveEvidence(item,catalog);
    if (item.score === null && REASONS.includes(item.reason)) {
      unavailable[dimension] = item.reason;
    } else if (typeof item.score === 'number' && Number.isFinite(item.score)
      && item.score >= 0 && item.score <= 100 && evidenceValid(resolved, transcript)) {
      scores[dimension] = Math.round(item.score * 10) / 10;
      evidence[dimension] = resolved.map(e => ({userIndex:e.userIndex,quote:e.quote}));
    } else return null;
  }
  return {scores, unavailable, evidence};
}
function supportedScores(scores) {
  const available = {}, unavailable = {};
  for (const [key, value] of Object.entries(scores || {})) {
    if (/confidence|pronunciation|accent|tone|fluency|spoken delivery/i.test(key)) {
      unavailable[key] = 'NO_AUDIO_EVIDENCE';continue;
    }
    if (typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100) available[key] = value;
    else unavailable[key] = 'INSUFFICIENT_TEXT';
  }
  return {scores:available, unavailable};
}
function validateFindings(parsed, transcript, scores) {
  if (parsed?.mode !== MODE) return null;
  const byDimension = {};
  const catalog=new Map(findingCatalog(transcript).map(e=>[e.id,e]));
  const editorial=require('./feedbackEditorial');
  const findingEvidence={strengths:[],improvements:[]};
  function render(items, allowed, kind) {
    if (items.length > 3) throw new Error('Too many findings');
    return items.map(item => {
      const evidence=item?resolveEvidence(item,catalog):null;
      if (!item || !allowed.includes(item.criterion) || !(item.dimension in scores)
        || !Object.hasOwn(scores,item.dimension)
        || !evidenceValid(evidence, transcript)) throw new Error('Unsupported finding');
      const selected=item.evidenceIds?.map(id=>catalog.get(id)).find(e=>e?.topic);
      const topic=editorial.topicFor({...item,topic:selected?.topic??item.topic},evidence);
      const coaching=require('./feedbackCoaching').validate(item,evidence,kind);
      const text=coaching?.observation||editorial.finding(item.criterion,topic);
      findingEvidence[kind].push({dimension:item.dimension,criterion:item.criterion,topic,text,evidence,...(coaching?{coaching}:{})});
      byDimension[item.dimension] ||= {strengths:[],improvements:[]};
      byDimension[item.dimension][kind].push(text);
      return text;
    });
  }
  try {
    if (parsed.dimensionFindings) {
      if (typeof parsed.dimensionFindings !== 'object' || Array.isArray(parsed.dimensionFindings)
        || Object.keys(parsed.dimensionFindings).some(d => !Object.hasOwn(scores,d))) return null;
      const strengths = [], improvements = [];
      for (const dimension of Object.keys(scores)) {
        let item = parsed.dimensionFindings[dimension];
        const rubric = rubricFor(dimension);
        if(item&&Object.hasOwn(item,'strength')&&Object.hasOwn(item,'improvement')) {
          if(Object.hasOwn(item,'strengths')||Object.hasOwn(item,'improvements'))return null;
          const single=value=>value===null?[]:[{...value,evidenceIds:[value?.evidenceId]}];
          item={strengths:single(item.strength),improvements:single(item.improvement),reason:item.reason};
        }
        if (!item || !Array.isArray(item.strengths) || !Array.isArray(item.improvements)
          || item.strengths.length > 1 || item.improvements.length > 1
          || (!item.strengths.length && !item.improvements.length && item.reason !== 'NO_SUPPORTED_FINDING')) return null;
        strengths.push(...render(item.strengths.map(f => ({...f,dimension})),rubric.strengths,'strengths'));
        improvements.push(...render(item.improvements.map(f => ({...f,dimension})),rubric.improvements,'improvements'));
      }
      const opposites={EXAMPLE:'ADD_EXAMPLE',CONCRETE_EXAMPLE:'ADD_EXAMPLE',LOGICAL_SEQUENCE:'ORGANIZE',ROLE_LINK:'LINK_ROLE'};
      for(const strength of findingEvidence.strengths) {
        if(findingEvidence.improvements.some(improvement=>improvement.dimension===strength.dimension
          && improvement.criterion===opposites[strength.criterion]
          && improvement.evidence.some(i=>strength.evidence.some(s=>s.userIndex===i.userIndex&&s.quote===i.quote)))) return null;
      }
      const display=editorial.compose(scores,findingEvidence);
      if(parsed.takeaway){
        const proof=resolveEvidence(parsed.takeaway,catalog);
        if(!evidenceValid(proof,transcript))return null;
        display.summary=require('./feedbackCoaching').text(parsed.takeaway.text,proof,50,360);
        if(!display.summary)return null;
      }
      const coaching=findingEvidence.improvements.filter(f=>f.coaching);
      if(coaching.length)display.recommendations=[coaching[0].coaching.exercise];
      return {...display,byDimension,findingEvidence};
    }
    if (!Array.isArray(parsed.strengths) || !Array.isArray(parsed.improvements)) return null;
    render(parsed.strengths, ['EXAMPLE','BACKGROUND','ROLE_GOAL'], 'strengths');
    render(parsed.improvements, ['ADD_EXAMPLE','ADD_IMPACT','ORGANIZE'], 'improvements');
    return {...editorial.compose(scores,findingEvidence),byDimension,findingEvidence};
  } catch (_) {return null;}
}
// Revalidate scoring evidence at the asynchronous report boundary. Only scored
// content dimensions and the closed, validated findings enter the saved detail.
function dimensionAnalysis(evidence, findings, transcript, scores, unavailable = {}) {
  return Object.fromEntries([...new Set([...Object.keys(scores),...Object.keys(unavailable)])].map(d => [d, {
    description:rubricFor(d).description,
    practice:unavailable[d] ? '' : rubricFor(d).practice,
    ...(unavailable[d] ? {reason:unavailable[d]} : {}),
    evidence:!unavailable[d] && evidenceValid(evidence?.[d], transcript)
      ? evidence[d].map(e => ({userIndex:e.userIndex,quote:e.quote})) : [],
    strengths:unavailable[d] ? [] : findings.byDimension?.[d]?.strengths || [],
    improvements:unavailable[d] ? [] : findings.byDimension?.[d]?.improvements || [],
    findingEvidence:unavailable[d]?[]:[...(findings.findingEvidence?.strengths||[]),...(findings.findingEvidence?.improvements||[])].filter(f=>f.dimension===d)
  }]));
}
const limitations = ['Transcript-only assessment: pronunciation, accent, vocal tone and acoustic confidence are not assessed.'];
module.exports = {MODE, FINDINGS, userTexts, evidenceCatalog, findingCatalog, evidenceValid, validateAssessment, validateFindings, dimensionAnalysis, supportedScores, limitations};

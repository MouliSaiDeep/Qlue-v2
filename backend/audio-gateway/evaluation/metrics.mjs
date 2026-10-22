export function tokens(text){return text.normalize('NFKC').toLowerCase().replace(/[’']/gu,'').match(/[\p{L}\p{N}\p{M}]+/gu)??[];}
export function wer(reference,hypothesis){
  const ref=tokens(reference),hyp=tokens(hypothesis);
  if(!ref.length)return null;
  if(ref.length>2000||hyp.length>2000)throw Error('EVALUATION_WORD_LIMIT');
  const width=hyp.length+1,trace=new Uint8Array((ref.length+1)*width);
  let previous=Uint16Array.from({length:width},(_,i)=>i);
  for(let j=1;j<width;j++)trace[j]=3;
  for(let i=1;i<=ref.length;i++){
    const row=new Uint16Array(width);row[0]=i;trace[i*width]=2;
    for(let j=1;j<width;j++){
      if(ref[i-1]===hyp[j-1]){row[j]=previous[j-1];continue;}
      const costs=[previous[j-1]+1,previous[j]+1,row[j-1]+1],min=Math.min(...costs);
      row[j]=min;trace[i*width+j]=costs.indexOf(min)+1;
    }previous=row;
  }
  let i=ref.length,j=hyp.length,s=0,d=0,insertions=0;const incorrectHypothesisTokens=[];
  while(i||j){const op=trace[i*width+j];
    if(op===0){i--;j--;}else if(op===1){s++;incorrectHypothesisTokens.push(j-1);i--;j--;}
    else if(op===2){d++;i--;}else{insertions++;incorrectHypothesisTokens.push(j-1);j--;}}
  return {wer:(s+d+insertions)/ref.length,substitutions:s,deletions:d,insertions,referenceWords:ref.length,hypothesisWords:hyp.length,incorrectHypothesisTokens:incorrectHypothesisTokens.sort((a,b)=>a-b)};
}
export function confidenceUsefulness(reference,words,threshold=.80){
  // Word tokenization alignment is explicit: a word split into two display
  // tokens carries the same raw score on each. Deletions have no ASR score.
  const expanded=words.flatMap(w=>tokens(w.text).map(text=>({text,confidence:w.confidence}))),comparison=wer(reference,expanded.map(w=>w.text).join(' '));
  if(!comparison)return null;
  const wrong=new Set(comparison.incorrectHypothesisTokens);let known=0,flagged=0,flaggedErrors=0,scoredErrors=0;
  expanded.forEach((w,i)=>{if(typeof w.confidence!=='number'||!Number.isFinite(w.confidence)||w.confidence<0||w.confidence>1)return;
    known++;if(wrong.has(i))scoredErrors++;if(w.confidence<threshold){flagged++;if(wrong.has(i))flaggedErrors++;}});
  return {threshold,calibrated:false,available:known,missing:expanded.length-known,flagged,flaggedErrors,
    flaggedErrorPrecision:flagged?flaggedErrors/flagged:null,scoredErrorRecall:scoredErrors?flaggedErrors/scoredErrors:null,
    deletionsWithoutScores:comparison.deletions};
}
export function percentiles(samples,minSamples=30){
  const valid=samples.filter(Number.isFinite).sort((a,b)=>a-b);
  const pick=p=>valid[Math.max(0,Math.ceil(valid.length*p)-1)];
  return {count:valid.length,sufficientSamples:valid.length>=minSamples,p50:valid.length>=minSamples?pick(.50):null,p95:valid.length>=minSamples?pick(.95):null};
}
export function technicalTerms(reference,hypothesis,terms){
  const contains=(text,phrase)=>` ${tokens(text).join(' ')} `.includes(` ${tokens(phrase).join(' ')} `);
  return terms.filter(t=>contains(reference,t.term)).map(t=>({term:t.term,recognized:[t.term,...t.aliases??[]].some(alias=>contains(hypothesis,alias))}));
}

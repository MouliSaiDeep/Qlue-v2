// Bounded editorial text remains untrusted. Exact proof, factual identifiers
// and explicit absence of acoustic/hiring judgments are checked separately.
const acoustic=/\b(?:confidence|confident|nervous|pronunciation|accent|vocal|emotion|fluency|percentile|hiring.ready)\b/i;
const common=new Set('Your You The This That Use Lead Write Explain Practice Rehearse State Describe Compare Focus For In To Next Add Keep Without Avoid Include Clarify Separate Connect Outline Review Check An A One Two Three API PDF STAR'.split(' '));
function text(value,evidence,maxWords,maxChars){
 if(typeof value!=='string'||value.trim()!==value||value.length>maxChars||value.split(/\s+/).filter(Boolean).length>maxWords||acoustic.test(value)||/["“”]/.test(value)||/(?:^|[\s:,])['‘][^'’\n]{3,}['’](?=$|[\s.,;:])/.test(value))throw Error('Unsafe coaching text');
 if(/\b(?:such as|for example|e\.g\.)\b/i.test(value)&&!value.includes('[verified result]'))throw Error('Unverified example coaching');
 const source=evidence.map(e=>e.quote).join(' ');
 for(const number of value.match(/\b\d+(?:\.\d+)?%?\b/g)||[])if(!source.includes(number))throw Error('Unsupported coaching number');
 for(const word of value.match(/\b[A-Z][a-zA-Z0-9]+\b/g)||[])if(!common.has(word)&&!new RegExp(`\\b${word}\\b`).test(source))throw Error('Unsupported coaching identity');
 return value;
}
function validate(item,evidence,kind){
 if(item.coaching===undefined)return null; // explicit pre-coaching format compatibility
 const c=item.coaching;
 if(!c||typeof c!=='object'||Array.isArray(c)||Object.keys(c).some(k=>!['observation','why','how','exercise'].includes(k)))throw Error('Invalid coaching');
 const result={observation:text(c.observation,evidence,25,200),why:text(c.why,evidence,35,260),how:text(c.how,evidence,35,260),exercise:text(c.exercise,evidence,30,240)};
 if(!result.observation||(kind==='improvements'&&(!result.why||!result.how||!result.exercise)))throw Error('Incomplete coaching');
 if(kind==='strengths'&&(result.how||result.exercise))throw Error('Unrequested coaching criticism');
 return result;
}
module.exports={validate,text};

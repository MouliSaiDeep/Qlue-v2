// Conservative reservation for a small, fully known Converse request. This
// replaces reserving an entire 1M-token context for a ~10KB synthetic prompt.
// UTF-8 byte count already bounds ordinary byte-tokenized content; the 4x
// multiplier plus 32K tokens also covers wrappers/schema expansion. Unknown
// requests retain the entire allowance. Never use this for hidden attachments.
const {createHash}=require('node:crypto');
function reserveRequest(budget,label,params){
 const bytes=Buffer.byteLength(JSON.stringify(params));
 if(typeof params.system!=='string'||!Array.isArray(params.messages)||params.messages.some(m=>!Array.isArray(m.content)||m.content.some(c=>Object.keys(c).join()!=='text'||typeof c.text!=='string')))throw Error('UNBOUNDED_MODEL_REQUEST');
 if(bytes>100000||!Number.isSafeInteger(params.max_tokens)||params.max_tokens<1||params.max_tokens>10000)throw Error('UNBOUNDED_MODEL_REQUEST');
 const inputTokenUpperBound=bytes*4+32768;
 const reservation=(inputTokenUpperBound*.15+params.max_tokens*.65)/1e6;
 budget.reserve('model',label,reservation,.45);
 const entry=budget.state.entries.find(e=>e.label===label);
 entry.bound={requestSha256:createHash('sha256').update(JSON.stringify(params)).digest('hex'),requestUtf8Bytes:bytes,inputTokenUpperBound,
  outputTokenUpperBound:params.max_tokens,method:'utf8-bytes-times-four-plus-32768',pricingChecked:'2026-10-25',inputUsdPerMillion:.15,outputUsdPerMillion:.65};
 budget.save();return entry.bound;
}
module.exports={reserveRequest};

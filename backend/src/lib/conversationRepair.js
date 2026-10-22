'use strict';

// Entire, explicit name corrections only. Keep mixed correction + substantive
// answers in the assessment; a keyword in a technical answer is never control.
function isNameCorrection(text) {
  if(typeof text!=='string'||text.length>500)return false;
  const normalized=text.toLowerCase().replace(/[.,!?;:]/g,' ').replace(/\s+/g,' ').trim();
  const at=normalized.indexOf('my name is ');
  if(at<0)return false;
  const before=normalized.slice(0,at).trim(),after=normalized.slice(at+11).replace(/\s+(?:ok|okay|thank you|thanks)$/,'').trim();
  if(!/\b(?:wrong|misheard|incorrect|correction|actually)\b/.test(before)&&!after.includes(' not '))return false;
  const allowed=new Set('sorry you i think have heard my name in a wrong way got it the that is was incorrectly incorrect misheard correction actually no pronounced said'.split(' '));
  if(before.split(' ').filter(Boolean).some(w=>!allowed.has(w)))return false;
  if(!/^[\p{L}'’\-]+(?: [\p{L}'’\-]+){0,6}$/u.test(after))return false;
  return !/\b(?:and|but|built|worked|implemented|developed|using|because|project|system|server|client|api)\b/.test(after);
}
module.exports={isNameCorrection};

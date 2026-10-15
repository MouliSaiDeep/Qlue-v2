const {createHash}=require('node:crypto');
function canonical(value){if(Array.isArray(value)) return value.map(canonical);if(value&&typeof value==='object')return Object.fromEntries(Object.keys(value).sort().map(k=>[k,canonical(value[k])]));return value;}
function digest(value){return createHash('sha256').update(typeof value==='string'?value:JSON.stringify(canonical(value))).digest('hex');}
function resumeRevision(resume){return resume.parseAttemptId||resume.parseVersion||resume.s3VersionId||digest(resume.parsedData||{});}
module.exports={digest,resumeRevision};

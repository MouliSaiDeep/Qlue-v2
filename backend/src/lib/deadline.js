const diagnostics=require('./logger').safeConsole;
const { AsyncLocalStorage }=require('node:async_hooks');
const work=new AsyncLocalStorage();
function current(){return work.getStore();}
function remaining(reserve=true){const ctx=current();return ctx ? (reserve?ctx.workUntil:ctx.finishUntil)-Date.now() : Infinity;}
function absolute(fallbackMs=25000){return Math.min(Date.now()+fallbackMs,current()?.workUntil||Infinity);}
async function bounded(operation,{deadlineAt=absolute(),label='operation'}={}) {
  const controller=new AbortController(); let timer;
  if(deadlineAt<=Date.now()) throw Object.assign(new Error(`${label} deadline exhausted`),{code:'DeadlineExceeded'});
  const timeout=new Promise((_,reject)=>{timer=setTimeout(()=>{controller.abort();reject(Object.assign(new Error(`${label} deadline exhausted`),{code:'DeadlineExceeded'}));},deadlineAt-Date.now());});
  const started=Date.now();
  try {return await Promise.race([operation(controller.signal),timeout]);}
  catch(error){controller.abort();throw error;}
  finally {clearTimeout(timer); if(current()) diagnostics.info(JSON.stringify({metric:label,durationMs:Date.now()-started}));}
}
function sendBounded(client,command,options={}) {return bounded(signal=>client.send(command,{...options,abortSignal:signal}),{deadlineAt:options.finish?current()?.finishUntil:options.deadlineAt||absolute(50000),label:options.label||command.constructor.name});}
function withDeadline(context,fn,{maxMs=25000,userId,action,reserveMs=4000}={}) {
  const finishUntil=Date.now()+Math.min(maxMs,context?.getRemainingTimeInMillis?.()||maxMs);
  return work.run({finishUntil,workUntil:finishUntil-reserveMs,userId,action},fn);
}
// Bind a verified owner without extending the parent's absolute deadline.
// A batch can contain work belonging to different users.
function withIdentity(userId,fn) {
  if(typeof userId!=='string'||!userId.trim())throw new Error('Verified paid-work owner is required');
  return current()?work.run({...current(),userId},fn):withDeadline(null,fn,{maxMs:60000,userId});
}
function finalize(fn) {
  const ctx=current();
  return ctx?work.run({...ctx,workUntil:ctx.finishUntil-250},fn):fn();
}
async function* streamBounded(stream,{maxBytes=10*1024*1024,label='stream',deadlineAt=absolute(50000)}={}) {
  const iterator=stream[Symbol.asyncIterator]();
  let bytes=0;
  try {
    while(true) {
      const item=await bounded(()=>iterator.next(),{deadlineAt,label});
      if(item.done) return;
      bytes+=Buffer.isBuffer(item.value)?item.value.length:typeof item.value==='string'?Buffer.byteLength(item.value):Buffer.byteLength(JSON.stringify(item.value));
      if(bytes>maxBytes) throw new Error(`${label} exceeds byte limit`);
      yield item.value;
    }
  } finally {stream.destroy?.();Promise.resolve(stream.cancel?.()).catch(()=>{});}
}
module.exports={current,remaining,absolute,bounded,sendBounded,withDeadline,withIdentity,streamBounded,finalize};

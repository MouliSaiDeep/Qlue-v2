// Actual packaged native inference: fixed public model and synthetic silence.
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict'),crypto=require('node:crypto');
assert.equal(process.platform,'linux');assert.equal(process.arch,'arm64');
const root=process.argv[2]?path.resolve(process.argv[2]):path.resolve(__dirname,'../backend/.aws-sam/build');
const native=path.join(root,'DeliveryRuntimeLayer/nodejs/node_modules');
const model=path.join(root,'DeliveryRuntimeLayer/delivery/models/silero_vad.onnx');
const delivery=require('../backend/src/lib/deliveryAnalysis');
assert.equal(crypto.createHash('sha256').update(fs.readFileSync(model)).digest('hex'),delivery.MODEL_SHA);
process.env.DELIVERY_VAD_MODEL=model;
// Bind native import to the built layer, never a developer copy.
const Module=require('node:module'),resolve=Module._resolveFilename;
Module._resolveFilename=function(request,parent,...rest){return request==='onnxruntime-node'?require.resolve(path.join(native,request)):resolve.call(this,request,parent,...rest);};
(async()=>{
 const silent=await delivery.analyze(Buffer.alloc(160044),[80000]);assert.equal(silent.reason,'NO_DETECTED_SPEECH');
 assert.equal(silent.detector,'silero-v5');
 console.log(JSON.stringify({platform:process.platform,architecture:process.arch,modelHashVerified:true,nativeInference:true,silenceRejected:true}));
})().catch(e=>{console.error(e.name);process.exitCode=1;});

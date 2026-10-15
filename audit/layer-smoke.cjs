// Run only in the Lambda-compatible Linux arm64 container against SAM output.
const fs=require('fs'),path=require('path'),os=require('os');
const {Worker}=require('node:worker_threads');
const {PDFDocument}=require('../backend/node_modules/pdf-lib');
const layer=path.resolve(__dirname,'../backend/.aws-sam/build/AppDependenciesLayer/nodejs/node_modules');
if(process.platform!=='linux'||process.arch!=='arm64')throw new Error('This smoke gate requires Lambda-compatible Linux arm64');
const temp=fs.mkdtempSync(path.join(os.tmpdir(),'qlue-parser-smoke-'));
fs.symlinkSync(layer,path.join(temp,'node_modules'),'dir');
const workerPath=path.join(temp,'pdfValidationWorker.cjs');
fs.copyFileSync(path.resolve(__dirname,'../backend/src/lib/pdfValidationWorker.cjs'),workerPath);
function validate(bytes){return new Promise((resolve,reject)=>{
 const worker=new Worker(workerPath,{workerData:{bytes:Buffer.from(bytes),maxPages:15},resourceLimits:{maxOldGenerationSizeMb:128,maxYoungGenerationSizeMb:16,stackSizeMb:4}});
 const timeout=setTimeout(()=>{worker.terminate();reject(new Error('Packaged parser deadline'));},10000);
 worker.once('message',value=>{clearTimeout(timeout);worker.terminate();resolve(value);});
 worker.once('error',error=>{clearTimeout(timeout);reject(error);});
});}
(async()=>{
 const valid=await PDFDocument.create();valid.addPage();
 if((await validate(await valid.save({useObjectStreams:true}))).pages!==1)throw new Error('Valid compressed PDF failed');
 const over=await PDFDocument.create();for(let i=0;i<16;i++)over.addPage();
 if((await validate(await over.save({useObjectStreams:true}))).error!=='PAGE_LIMIT')throw new Error('Over-limit compressed PDF accepted');
 if(!(await validate(Buffer.from('%PDF-1.7 /ObjStm %%EOF'))).error)throw new Error('Malformed PDF accepted');
 console.log(JSON.stringify({platform:process.platform,architecture:process.arch,packagedParserCases:3,passed:3}));
})().catch(error=>{console.error(error.name,error.message);process.exitCode=1;});

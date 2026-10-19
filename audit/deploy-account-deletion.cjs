// Narrow update: current handler bundle plus the deletion API's additive queue
// permission/environment and internally authenticated route. Reuse live layers.
const fs=require('node:fs'),path=require('node:path'),crypto=require('node:crypto');
const {promisify}=require('node:util');
const execFile=promisify(require('node:child_process').execFile);
const readCfn=require('./read-cfn.cjs');
const dir=path.resolve(__dirname,'../tmp/account-deletion');fs.mkdirSync(dir,{recursive:true});
const save=(name,data)=>fs.writeFileSync(path.join(dir,name+'.json'),JSON.stringify(data,null,2)+'\n');
const read=name=>JSON.parse(fs.readFileSync(path.join(dir,name+'.json'),'utf8'));
async function aws(args){
  const {stdout}=await execFile('C:/Program Files/Amazon/AWSCLIV2/aws.exe',[...args,'--region','us-east-1','--output','json','--no-cli-pager','--cli-connect-timeout','5','--cli-read-timeout','20'],
    {timeout:35000,maxBuffer:24*1024*1024,env:{...process.env,AWS_MAX_ATTEMPTS:'1',AWS_EC2_METADATA_DISABLED:'true'}});
  return stdout.trim()?JSON.parse(stdout):{};
}
async function prepare(){
  if(fs.existsSync(path.join(dir,'preparation.json')))throw Error('Existing preparation must be retained');
  const stack=(await aws(['cloudformation','describe-stacks','--stack-name','qlue-dev'])).Stacks[0];
  if(stack.StackStatus!=='UPDATE_COMPLETE')throw Error('Stack is not ready');
  const rs=(await aws(['cloudformation','list-stack-resources','--stack-name','qlue-dev'])).StackResourceSummaries;
  save('resources',rs);
  const live=await aws(['cloudformation','get-template','--stack-name','qlue-dev','--template-stage','Original']);
  const t=typeof live.TemplateBody==='string'?readCfn(live.TemplateBody):live.TemplateBody;
  save('before-template',t);
  const deployed=await aws(['lambda','get-function','--function-name',rs.find(r=>r.LogicalResourceId==='DeleteAccountFunction').PhysicalResourceId]);
  const zip=await fetch(deployed.Code.Location,{signal:AbortSignal.timeout(20000)});
  if(!zip.ok)throw Error('Could not read deployed handler bundle');
  fs.writeFileSync(path.join(dir,'before-code.zip'),Buffer.from(await zip.arrayBuffer()));
  const python='C:/Users/pedir/AppData/Local/Programs/Python/Python313/python.exe';
  const {stdout}=await execFile(python,['-c',
    `import zipfile,pathlib,json,hashlib\nr=pathlib.Path('backend/src'); z=zipfile.ZipFile('tmp/account-deletion/before-code.zip'); changed=[]\nfor p in r.rglob('*'):\n if p.is_file() and (p.relative_to(r).as_posix() not in z.namelist() or z.read(p.relative_to(r).as_posix())!=p.read_bytes()): changed.append(p.relative_to(r).as_posix())\nassert set(changed)<=set(['handlers/auth/deleteAccount.js','handlers/auth/deletionWorker.js','lib/accountDeletion.js']),changed\nwith zipfile.ZipFile('tmp/account-deletion/code.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9) as out:\n for p in sorted(r.rglob('*')):\n  if p.is_file(): out.write(p,p.relative_to(r).as_posix())\nprint(json.dumps({'changedFiles':changed,'files':len(z.namelist())}))`],
    {cwd:path.resolve(__dirname,'..'),timeout:30000});
  const parity=JSON.parse(stdout);save('source-parity',parity);
  const canonical=readCfn(fs.readFileSync(path.resolve(__dirname,'../backend/template.yaml'),'utf8'));
  const source=canonical.Resources.DeleteAccountFunction;
  const previous=t.Resources.DeleteAccountFunction;
  // Prove that this changes only env, events and an added policy on this role.
  const omit=r=>Object.fromEntries(Object.entries(r.Properties).filter(([k])=>!['CodeUri','Events','Environment','Policies'].includes(k)));
  if(JSON.stringify(omit(source))!==JSON.stringify(omit(previous)))throw Error('Unexpected API property change');
  const oldPolicies=previous.Properties.Policies;
  if(!oldPolicies.every(p=>source.Properties.Policies.some(q=>JSON.stringify(q)===JSON.stringify(p))))throw Error('Existing policy removed');
  const oldEnv=previous.Properties.Environment?.Variables||{},newEnv=source.Properties.Environment.Variables;
  if(!Object.entries(oldEnv).every(([k,v])=>JSON.stringify(newEnv[k])===JSON.stringify(v)))throw Error('Existing API environment changed');
  const uri=previous.Properties.CodeUri;
  const bucket=typeof uri==='string'?/^s3:\/\/([^/]+)\//.exec(uri)?.[1]:uri.Bucket;
  if(!bucket?.startsWith('aws-sam-cli-managed-default-'))throw Error('Unexpected artifact bucket');
  const code=path.join(dir,'code.zip');
  const hash=crypto.createHash('sha256').update(fs.readFileSync(code)).digest('hex');
  const key=`qlue-dev/account-deletion/${hash}.zip`;
  await aws(['s3api','put-object','--bucket',bucket,'--key',key,'--body',code,'--server-side-encryption','AES256']);
  let count=0;
  for(const r of Object.values(t.Resources))if(r.Type==='AWS::Serverless::Function'){r.Properties.CodeUri={Bucket:bucket,Key:key};count++;}
  if(count!==60)throw Error('Unexpected function count');
  for(const k of ['Events','Environment','Policies'])previous.Properties[k]=source.Properties[k];
  save('packaged-template',t);
  const templateKey=`qlue-dev/account-deletion/${hash}.template`;
  await aws(['s3api','put-object','--bucket',bucket,'--key',templateKey,'--body',path.join(dir,'packaged-template.json'),'--server-side-encryption','AES256']);
  const result=await aws(['cloudformation','create-change-set','--stack-name','qlue-dev','--change-set-name','qlue-account-deletion-'+Date.now(),'--change-set-type','UPDATE',
    '--template-url',`https://${bucket}.s3.us-east-1.amazonaws.com/${templateKey}`,'--capabilities','CAPABILITY_IAM','--parameters',JSON.stringify(stack.Parameters.map(p=>({ParameterKey:p.ParameterKey,UsePreviousValue:true})))]);
  save('preparation',{...result,hash,functionCount:count});
  console.log(JSON.stringify({prepared:true,handlerChanges:parity.changedFiles,functionCount:count,reusedLiveLayers:true}));
}
async function review(){
  const x=read('preparation');
  const cs=await aws(['cloudformation','describe-change-set','--change-set-name',x.Id]);save('changeset',cs);
  if(cs.Status!=='CREATE_COMPLETE')throw Error('Change set not ready: '+cs.Status);
  const decode=x=>typeof x.TemplateBody==='string'?readCfn(x.TemplateBody):x.TemplateBody;
  const before=decode(await aws(['cloudformation','get-template','--stack-name','qlue-dev','--template-stage','Processed']));
  const after=decode(await aws(['cloudformation','get-template','--stack-name','qlue-dev','--change-set-name',x.Id,'--template-stage','Processed']));
  save('before-processed',before);save('after-processed',after);
  const stable=x=>JSON.stringify(x,(_,v)=>v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.entries(v).sort(([a],[b])=>a.localeCompare(b))):v);
  const allowed=['AWS::Lambda::Function','AWS::ApiGateway::RestApi','AWS::ApiGateway::Deployment','AWS::ApiGateway::Stage','AWS::IAM::Role'];
  for(const {ResourceChange:r} of cs.Changes){
    if(r.Replacement==='True')throw Error('Resource replacement '+r.LogicalResourceId);
    // CloudFormation reports cascaded ARN references as dynamic modifications
    // when handler code changes; prove these resources are byte-equivalent.
    if(r.Action==='Modify'&&stable(before.Resources[r.LogicalResourceId])===stable(after.Resources[r.LogicalResourceId]))continue;
    if(!allowed.includes(r.ResourceType))throw Error('Unexpected resource type '+r.ResourceType);
    if(r.Action!=='Modify'&&r.ResourceType!=='AWS::ApiGateway::Deployment')throw Error('Unexpected resource mutation '+r.LogicalResourceId);
    if(r.ResourceType==='AWS::IAM::Role'&&r.LogicalResourceId!=='DeleteAccountFunctionRole')throw Error('Unexpected role change');
  }
  const review={safe:true,resources:cs.Changes.map(({ResourceChange:r})=>({id:r.LogicalResourceId,type:r.ResourceType,action:r.Action,replacement:r.Replacement})),dataResourcesChanged:0};
  save('review',review);console.log(JSON.stringify({safe:true,resources:review.resources.length,dataResourcesChanged:0}));
}
async function prepareNarrow(){
  const previous=read('preparation');
  if(!fs.existsSync(path.join(dir,'broad-preparation.json')))save('broad-preparation',previous);
  const t=read('before-template'),packaged=read('packaged-template');
  const changed=['DeleteAccountFunction','DeletionWorkerFunction','UpdateGlobalProfileFunction'];
  const {stdout}=await execFile('C:/Users/pedir/AppData/Local/Programs/Python/Python313/python.exe',['-c',
    `import zipfile,pathlib,json\nr=pathlib.Path('backend/src');z=zipfile.ZipFile('tmp/account-deletion/before-code.zip');changed=[]\nfor p in r.rglob('*'):\n if p.is_file() and z.read(p.relative_to(r).as_posix())!=p.read_bytes():changed.append(p.relative_to(r).as_posix())\nassert set(changed)<=set(['handlers/auth/deleteAccount.js','handlers/auth/deletionWorker.js','handlers/dashboard/updateGlobalProfile.js','lib/accountDeletion.js']),changed\nwith zipfile.ZipFile('tmp/account-deletion/code.zip','w',zipfile.ZIP_DEFLATED,compresslevel=9) as out:\n for p in sorted(r.rglob('*')):\n  if p.is_file():out.write(p,p.relative_to(r).as_posix())\nprint(json.dumps({'changedFiles':changed}))`],{cwd:path.resolve(__dirname,'..'),timeout:30000});
  save('source-parity',JSON.parse(stdout));
  for(const id of changed)t.Resources[id]=packaged.Resources[id];
  const code=path.join(dir,'code.zip'),hash=crypto.createHash('sha256').update(fs.readFileSync(code)).digest('hex');
  const bucket=t.Resources.DeleteAccountFunction.Properties.CodeUri.Bucket;
  const codeKey=`qlue-dev/account-deletion/${hash}.zip`;
  await aws(['s3api','put-object','--bucket',bucket,'--key',codeKey,'--body',code,'--server-side-encryption','AES256']);
  for(const id of changed)t.Resources[id].Properties.CodeUri={Bucket:bucket,Key:codeKey};
  // All resources outside these two remain exactly the deployed SAM source.
  const before=read('before-template');
  for(const [id,r]of Object.entries(t.Resources))if(!changed.includes(id)&&JSON.stringify(r)!==JSON.stringify(before.Resources[id]))throw Error('Unexpected change '+id);
  const file=path.join(dir,'narrow-template.json');save('narrow-template',t);
  const key=`qlue-dev/account-deletion/${hash}-scoped.template`;
  await aws(['s3api','put-object','--bucket',bucket,'--key',key,'--body',file,'--server-side-encryption','AES256']);
  const stack=(await aws(['cloudformation','describe-stacks','--stack-name','qlue-dev'])).Stacks[0];
  if(stack.StackStatus!=='UPDATE_COMPLETE')throw Error('Stack not ready');
  const result=await aws(['cloudformation','create-change-set','--stack-name','qlue-dev','--change-set-name','qlue-delete-scoped-'+Date.now(),'--change-set-type','UPDATE',
    '--template-url',`https://${bucket}.s3.us-east-1.amazonaws.com/${key}`,'--capabilities','CAPABILITY_IAM','--parameters',JSON.stringify(stack.Parameters.map(p=>({ParameterKey:p.ParameterKey,UsePreviousValue:true})))]);
  save('preparation',{...result,hash,functionCount:3});
  console.log(JSON.stringify({prepared:true,functionCount:3,unrelatedResourcesUnchanged:true}));
}
async function execute(){
  if(!read('review').safe)throw Error('Review required');
  const x=read('preparation');
  const cs=await aws(['cloudformation','describe-change-set','--change-set-name',x.Id]);
  if(cs.Status!=='CREATE_COMPLETE'||cs.ExecutionStatus!=='AVAILABLE')throw Error('Change set not executable');
  await aws(['cloudformation','execute-change-set','--change-set-name',x.Id]);
  console.log(JSON.stringify({executing:true}));
}
async function status(){
  const stack=(await aws(['cloudformation','describe-stacks','--stack-name','qlue-dev'])).Stacks[0];
  console.log(JSON.stringify({status:stack.StackStatus}));
  if(stack.StackStatus==='UPDATE_COMPLETE'){
    save('completion',{completedAt:new Date().toISOString(),status:stack.StackStatus});
  }
}
async function verify(){
  const rs=read('resources'),t=read('before-processed');
  const expected=crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'code.zip'))).digest('base64');
  const old=crypto.createHash('sha256').update(fs.readFileSync(path.join(dir,'before-code.zip'))).digest('base64');
  const updated=new Set(['DeleteAccountFunction','DeletionWorkerFunction','UpdateGlobalProfileFunction']);
  const deployed=(await aws(['lambda','list-functions'])).Functions;
  const proof=[];
  for(const r of rs.filter(r=>r.ResourceType==='AWS::Lambda::Function')){
    const f=deployed.find(f=>f.FunctionName===r.PhysicalResourceId);if(!f)throw Error('Missing function '+r.LogicalResourceId);
    if(f.CodeSha256!==(updated.has(r.LogicalResourceId)?expected:old))throw Error('Unexpected handler artifact '+r.LogicalResourceId);
    proof.push({logical:r.LogicalResourceId,updated:updated.has(r.LogicalResourceId),hashMatches:true});
  }
  const mappings=(await aws(['lambda','list-event-source-mappings'])).EventSourceMappings.filter(m=>rs.some(r=>r.ResourceType==='AWS::Lambda::Function'&&m.FunctionArn.endsWith(':'+r.PhysicalResourceId)));
  if(mappings.length!==8||mappings.some(m=>m.State!=='Enabled'))throw Error('Recovery mapping state mismatch');
  const queues=[];
  for(const r of rs.filter(r=>r.ResourceType==='AWS::SQS::Queue'&&/DLQ/.test(r.LogicalResourceId))){
    const x=await aws(['sqs','get-queue-attributes','--queue-url',r.PhysicalResourceId,'--attribute-names','ApproximateNumberOfMessages','ApproximateNumberOfMessagesNotVisible']);
    queues.push({logical:r.LogicalResourceId,...x.Attributes});
  }
  const result={verifiedAt:new Date().toISOString(),functions:proof,updatedFunctions:proof.filter(f=>f.updated).length,unchangedFunctions:proof.filter(f=>!f.updated).length,enabledMappings:mappings.length,deadLetterQueues:queues};
  save('live-verification',result);
  console.log(JSON.stringify({updatedFunctions:result.updatedFunctions,unchangedFunctions:result.unchangedFunctions,enabledMappings:result.enabledMappings,deadLetterQueues:queues}));
}
const phases={prepare,review,execute,status,verify,'prepare-narrow':prepareNarrow};
(async()=>{if(!phases[process.argv[2]])throw Error('Use prepare, review, execute or status');await phases[process.argv[2]]();})().catch(e=>{console.error(e.name,e.message);process.exitCode=1;});

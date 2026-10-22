// Local/CI verification only. No AWS credentials or cloud resources are used.
import assert from 'node:assert/strict';
import {execFile} from 'node:child_process';
import {promisify} from 'node:util';
import {randomBytes} from 'node:crypto';
import http from 'node:http';
const args=process.argv.slice(2),image=args[args.indexOf('--image')+1];
if(!args.includes('--image')||!image||image.startsWith('-'))throw Error('Use --image reviewed-local-image');
const docker=process.env.DOCKER_CLI||'docker',name='qlue-stt-smoke-'+randomBytes(6).toString('hex');
const execute=async argv=>(await promisify(execFile)(docker,argv,{timeout:30000,windowsHide:true,maxBuffer:1000000})).stdout.trim();
let started=false;
try{
  await execute(['run','-d','--name',name,'--platform','linux/arm64','--read-only','--cap-drop','ALL','--security-opt','no-new-privileges',
    '-e','AWS_REGION=us-east-1','-e','AWS_EC2_METADATA_DISABLED=true','-p','127.0.0.1::8080',image]);started=true;
  const published=await execute(['port',name,'8080/tcp']);
  assert.match(published,/^127\.0\.0\.1:[0-9]+$/);
  const port=Number(published.split(':').at(-1));
  let health;
  const readyDeadline=Date.now()+30000;
  while(Date.now()<readyDeadline){
    try{const response=await fetch(`http://127.0.0.1:${port}/healthz`,{signal:AbortSignal.timeout(1000)});
      if(response.ok){health=await response.json();break;}}
    catch{}await new Promise(r=>setTimeout(r,250));
  }
  if(!health)console.error(await execute(['logs','--tail','20',name]));
  assert.deepEqual(health,{ready:true,sttEnabled:false,hosting:'ecs'});
  assert.notEqual(await execute(['exec',name,'node','-e','process.stdout.write(String(process.getuid()))']),'0');
  const status=await new Promise((resolve,reject)=>{
    const req=http.request({host:'127.0.0.1',port,path:'/audio',headers:{Connection:'Upgrade',Upgrade:'websocket',
      'Sec-WebSocket-Version':'13','Sec-WebSocket-Key':randomBytes(16).toString('base64'),'X-Forwarded-Proto':'https'}},res=>{res.resume();resolve(res.statusCode);});
    req.on('upgrade',(_,socket)=>{socket.destroy();reject(Error('Disabled gateway accepted an audio upgrade'));});
    req.on('error',reject);req.setTimeout(3000,()=>req.destroy(Error('Upgrade timeout')));req.end();
  });
  assert.equal(status,503);
  await execute(['stop','--time','20',name]);
  assert.equal(await execute(['inspect','--format','{{.State.ExitCode}}',name]),'0');
  console.info(JSON.stringify({passed:true,platform:'linux/arm64',health:true,nonRoot:true,readOnlyRoot:true,
    defaultAudioUpgradeRejected:true,gracefulExit:true,awsRequests:0}));
}finally{if(started)await execute(['rm','-f',name]);}

const {spawnSync}=require('node:child_process');
const path=require('node:path');
jest.mock('../../src/lib/websocket',()=>({postToConnection:jest.fn()}));
const {postToConnection}=require('../../src/lib/websocket');

test('every declared SAM Lambda has a callable runtime entrypoint',()=>{
  const root=path.resolve(__dirname,'../../..');
  const script=`
    const fs=require('fs'),path=require('path');
    const root=${JSON.stringify(root)};
    const t=require(path.join(root,'audit/read-cfn.cjs'))(fs.readFileSync(path.join(root,'backend/template.yaml'),'utf8'));
    let count=0;
    for(const [id,r]of Object.entries(t.Resources)){
      if(r.Type!=='AWS::Serverless::Function')continue;
      const h=r.Properties.Handler,split=h.lastIndexOf('.');
      if(typeof require(path.join(root,'backend/src',h.slice(0,split)))[h.slice(split+1)]!=='function')throw Error(id+' handler is not callable');
      count++;
    }
    console.log('CALLABLE_HANDLERS='+count);
  `;
  const result=spawnSync(process.execPath,['--experimental-require-module','-e',script],{encoding:'utf8',timeout:120000});
  expect({error:result.error?.message,status:result.status,stderr:result.stderr}).toEqual({error:undefined,status:0,stderr:''});
  const template = require('../../../audit/read-cfn.cjs')(require('node:fs').readFileSync(path.join(root,'backend/template.yaml'),'utf8'));
  const expected = Object.values(template.Resources).filter(resource => resource.Type === 'AWS::Serverless::Function').length;
  expect(result.stdout).toContain(`CALLABLE_HANDLERS=${expected}`);
},125000);

test('the deprecated state entrypoint sends no separate state frame',async()=>{
  expect(await require('../../src/handlers/websocket/stateUpdateHandler').handler({connectionId:'c'}))
    .toEqual({success:true,skipped:true});
  expect(postToConnection).not.toHaveBeenCalled();
});

test('the error entrypoint adapts the Lambda event to its existing utility',async()=>{
  postToConnection.mockResolvedValue(true);
  expect(await require('../../src/handlers/websocket/errorHandler').handler({connectionId:'c',errorCode:'CONTROLLED',message:'Please retry.',recoverable:true}))
    .toEqual({success:true});
  expect(postToConnection).toHaveBeenCalledWith('c',expect.objectContaining({type:'error',payload:expect.objectContaining({errorCode:'CONTROLLED'})}));
});

const {spawnSync}=require('node:child_process');
const path=require('node:path');
// Functional SDK compatibility, not a production latency benchmark. QEMU on
// a cross-architecture developer host needs a larger subprocess allowance.
const processTimeoutMs=Number(process.env.QLUE_TEST_PROCESS_TIMEOUT_MS||20000);
test('the real pinned Firebase SDK initializes auth/messaging and signs a controlled token without network',()=>{
 const root=path.resolve(__dirname,'../../..');
 const template=require('../../../../audit/read-cfn.cjs')(require('node:fs').readFileSync(path.join(root,'template.yaml'),'utf8'));
 expect(template.Globals.Function.Environment.Variables.NODE_OPTIONS).toBe('--experimental-require-module');
 const script=`
  const crypto=require('node:crypto');
  const {privateKey}=crypto.generateKeyPairSync('rsa',{modulusLength:2048});
  const secrets=require(${JSON.stringify(path.join(root,'src/lib/secrets.js'))});
  secrets.getFirebaseServiceAccount=async()=>({project_id:'qlue-offline-test',client_email:'offline@qlue-offline-test.iam.gserviceaccount.com',private_key:privateKey.export({type:'pkcs8',format:'pem'})});
  const lib=require(${JSON.stringify(path.join(root,'src/lib/firebase.js'))});
  (async()=>{
   const auth=await lib.getAuth();const messaging=await lib.getMessaging();
   if(auth!==await lib.getAuth()||typeof messaging.send!=='function')throw new Error('SDK service reuse failed');
   const token=await lib.createCustomToken('controlled-offline-uid');
   const claims=JSON.parse(Buffer.from(token.split('.')[1],'base64url'));
   if(claims.uid!=='controlled-offline-uid')throw new Error('Controlled token identity mismatch');
   console.log('REAL_FIREBASE_SDK_PASS');
  })().catch(e=>{console.error(e.name,e.message);process.exitCode=1});
 `;
 const result=spawnSync(process.execPath,[template.Globals.Function.Environment.Variables.NODE_OPTIONS,'-e',script],{cwd:require('node:os').tmpdir(),encoding:'utf8',timeout:processTimeoutMs});
 expect(result.error).toBeUndefined();
 expect({status:result.status,error:result.stderr}).toEqual({status:0,error:''});
 expect(result.stdout).toContain('REAL_FIREBASE_SDK_PASS');
},processTimeoutMs+5000);

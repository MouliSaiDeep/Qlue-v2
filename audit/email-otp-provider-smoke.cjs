// Real Cognito managed sender; recipient is AWS's mailbox simulator, not a person.
const assert=require('node:assert/strict'),path=require('node:path'),fs=require('node:fs'),crypto=require('node:crypto');
const backend=path.resolve(__dirname,'../backend'),load=name=>require(require.resolve(name,{paths:[backend]}));
const {CognitoIdentityProviderClient,CreateUserPoolCommand,CreateUserPoolClientCommand,AdminGetUserCommand,DeleteUserPoolCommand}=load('@aws-sdk/client-cognito-identity-provider');
const template=require('./read-cfn.cjs')(fs.readFileSync(path.join(backend,'template.yaml'),'utf8'));
const client=new CognitoIdentityProviderClient({region:'us-east-1',maxAttempts:1});
const name='qlue-otp-smoke-'+crypto.randomBytes(6).toString('hex');
let poolId,stage='create-pool';
async function main(){
  const properties=structuredClone(template.Resources.EmailOtpPool.Properties);
  delete properties.UserPoolName;
  const pool=await client.send(new CreateUserPoolCommand({...properties,PoolName:name}));poolId=pool.UserPool.Id;
  stage='create-client';
  const config=structuredClone(template.Resources.EmailOtpClient.Properties);config.UserPoolId=poolId;
  const app=await client.send(new CreateUserPoolClientCommand(config));
  Object.assign(process.env,{EMAIL_OTP_POOL_ID:poolId,EMAIL_OTP_CLIENT_ID:app.UserPoolClient.ClientId});
  const delivery=require('../backend/src/lib/emailOtpDelivery');delivery.resetCache();
  stage='managed-send';
  await delivery.send('synthetic-acceptance',`success+${name}@simulator.amazonses.com`);
  const username='qlue_'+crypto.createHash('sha256').update('synthetic-acceptance').digest('hex');
  stage='read-user';
  const user=await client.send(new AdminGetUserCommand({UserPoolId:poolId,Username:username}));
  assert.equal(user.UserStatus,'UNCONFIRMED');
  stage='reject-code';
  await assert.rejects(delivery.confirm('synthetic-acceptance','000000'),error=>['CodeMismatchException','ExpiredCodeException'].includes(error.name));
  await delivery.remove('synthetic-acceptance');
  console.log(JSON.stringify({pool:name,builtInSender:true,ownDomainRequired:false,ownSenderRequired:false,
    emailAcceptedByProvider:true,wrongCodeRejected:true,recipient:'AWS SES mailbox simulator',productionChanged:false}));
}
main().catch(error=>{console.error(stage,error.name,error.message);process.exitCode=1;}).finally(async()=>{
  if(poolId){try{await client.send(new DeleteUserPoolCommand({UserPoolId:poolId}));console.log('Temporary Cognito pool and client removed.');}
  catch(error){console.error('Cleanup required',name,error.name);process.exitCode=1;}}
  client.destroy();
});

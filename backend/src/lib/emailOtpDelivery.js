// Cognito's managed confirmation email works without an owned sender/domain.
// Firebase remains the only issuer of sessions accepted by the application.
const {createHash,createHmac,randomBytes}=require('node:crypto');
const {CognitoIdentityProviderClient,DescribeUserPoolClientCommand,AdminDeleteUserCommand,SignUpCommand,ConfirmSignUpCommand}=require('@aws-sdk/client-cognito-identity-provider');
const deadline=require('./deadline');
const client=new CognitoIdentityProviderClient({maxAttempts:1});
const username=uid=>'qlue_'+createHash('sha256').update(uid).digest('hex');
let cached;
async function configured(){
  const poolId=process.env.EMAIL_OTP_POOL_ID,clientId=process.env.EMAIL_OTP_CLIENT_ID;
  if(!poolId||!clientId)throw new Error('OTP pool is not configured');
  if(!cached||cached.poolId!==poolId||cached.clientId!==clientId||cached.until<Date.now()){
    const result=await deadline.sendBounded(client,new DescribeUserPoolClientCommand({UserPoolId:poolId,ClientId:clientId}));
    const key=result.UserPoolClient?.ClientSecret;
    if(typeof key!=='string'||key.length<32)throw new Error('OTP confidential client is unavailable');
    cached={poolId,clientId,key,until:Date.now()+3600000};
  }
  return cached;
}
async function remove(uid){
  if(!process.env.EMAIL_OTP_POOL_ID)return;
  try{await deadline.sendBounded(client,new AdminDeleteUserCommand({UserPoolId:process.env.EMAIL_OTP_POOL_ID,Username:username(uid)}));}
  catch(error){if(error.name!=='UserNotFoundException')throw error;}
}
const secretHash=(config,name)=>createHmac('sha256',config.key).update(name+config.clientId).digest('base64');
async function send(uid,email){
  const config=await configured(),name=username(uid);
  // Recreating one auxiliary record invalidates all older provider codes,
  // including after an ambiguous confirmation response. Never reuse passwords.
  await remove(uid);
  const sent=await deadline.sendBounded(client,new SignUpCommand({ClientId:config.clientId,Username:name,
    Password:'Aa1!'+randomBytes(32).toString('base64url'),SecretHash:secretHash(config,name),
    UserAttributes:[{Name:'email',Value:email}]}));
  if(sent.UserConfirmed===true||sent.CodeDeliveryDetails?.DeliveryMedium!=='EMAIL'){
    throw new Error('The provider did not accept an email verification challenge');
  }
}
async function confirm(uid,code){
  const config=await configured(),name=username(uid);
  await deadline.sendBounded(client,new ConfirmSignUpCommand({ClientId:config.clientId,Username:name,
    SecretHash:secretHash(config,name),ConfirmationCode:code,ForceAliasCreation:false}));
}
function resetCache(){cached=undefined;}
module.exports={configured,send,confirm,remove,resetCache};

const {mockClient}=require('aws-sdk-client-mock');
const {CognitoIdentityProviderClient,DescribeUserPoolClientCommand,AdminDeleteUserCommand,SignUpCommand,ConfirmSignUpCommand}=require('@aws-sdk/client-cognito-identity-provider');
const {createHash,createHmac}=require('node:crypto');
const sdk=mockClient(CognitoIdentityProviderClient),delivery=require('../../../src/lib/emailOtpDelivery');
beforeEach(()=>{
  sdk.reset();delivery.resetCache();Object.assign(process.env,{EMAIL_OTP_POOL_ID:'us-east-1_test',EMAIL_OTP_CLIENT_ID:'test-client'});
  sdk.on(DescribeUserPoolClientCommand).resolves({UserPoolClient:{ClientSecret:'s'.repeat(48)}});
  sdk.on(AdminDeleteUserCommand).resolves({});
  sdk.on(SignUpCommand).resolves({UserConfirmed:false,CodeDeliveryDetails:{DeliveryMedium:'EMAIL'}});
  sdk.on(ConfirmSignUpCommand).resolves({});
});
afterAll(()=>sdk.restore());
test('managed sender needs no SES identity, custom domain, or user password',async()=>{
  await delivery.send('firebase-uid','user@example.com');
  const request=sdk.commandCalls(SignUpCommand)[0].args[0].input;
  const name='qlue_'+createHash('sha256').update('firebase-uid').digest('hex');
  expect(request.Username).toBe(name);expect(request.UserAttributes).toEqual([{Name:'email',Value:'user@example.com'}]);
  expect(request.Password.length).toBeGreaterThanOrEqual(32);
  expect(request.SecretHash).toBe(createHmac('sha256','s'.repeat(48)).update(name+'test-client').digest('base64'));
  expect(sdk.commandCalls(AdminDeleteUserCommand)[0].args[0].input.Username).toBe(name);
});
test('confidential client secret is cached internally and never supplied by the app',async()=>{
  await delivery.send('u','user@example.com');await delivery.confirm('u','000042');
  expect(sdk.commandCalls(DescribeUserPoolClientCommand)).toHaveLength(1);
  const confirm=sdk.commandCalls(ConfirmSignUpCommand)[0].args[0].input;
  expect(confirm).toMatchObject({ConfirmationCode:'000042',ForceAliasCreation:false});
  expect(confirm.SecretHash).toEqual(expect.any(String));
});
test('an absent auxiliary account is safe to delete before issuing a new code',async()=>{
  sdk.on(AdminDeleteUserCommand).rejects({name:'UserNotFoundException'});
  await expect(delivery.send('u','user@example.com')).resolves.toBeUndefined();
});
test('a provider response with no email challenge is a failure',async()=>{
  sdk.on(SignUpCommand).resolves({UserConfirmed:true});
  await expect(delivery.send('u','user@example.com')).rejects.toThrow('did not accept');
});
test('provider code rejection is preserved for the attempt limiter',async()=>{
  sdk.on(ConfirmSignUpCommand).rejects({name:'CodeMismatchException'});
  await expect(delivery.confirm('u','000042')).rejects.toMatchObject({name:'CodeMismatchException'});
});

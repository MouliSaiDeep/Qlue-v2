const {mockClient} = require('aws-sdk-client-mock');
const {DynamoDBDocumentClient,GetCommand,UpdateCommand,TransactWriteCommand}=require('@aws-sdk/lib-dynamodb');
jest.mock('../../src/lib/emailOtpDelivery',()=>({configured:jest.fn(),send:jest.fn(),confirm:jest.fn(),remove:jest.fn()}));
const delivery=require('../../src/lib/emailOtpDelivery');
jest.mock('../../src/lib/firebase',()=>({getAuth:jest.fn()}));
jest.mock('../../src/lib/deletionJob',()=>({assertNotDeleting:jest.fn()}));
const firebase=require('../../src/lib/firebase'),ddb=require('../../src/lib/dynamodb');
const db=mockClient(DynamoDBDocumentClient);
const otp=require('../../src/lib/emailOtp');
const endpoint=require('../../src/handlers/auth/emailOtp');
let write,auth,person;
const event=body=>({headers:{Authorization:'Bearer test-token'},body:JSON.stringify(body||{}),requestContext:{identity:{sourceIp:'127.0.0.1'}}});
const saved=()=>write.mock.calls.flatMap(([c])=>c.input.TransactItems||[]).find(item=>item.Put)?.Put.Item;
const deliveredCode=()=> '000042';
beforeEach(()=>{
  jest.clearAllMocks();db.reset();
  Object.assign(process.env,{EMAIL_OTP_TABLE:'otp-test',EMAIL_OTP_DAILY_LIMIT:'40'});
  db.on(GetCommand).resolves({});
  delivery.configured.mockResolvedValue({key:'x'.repeat(48)});
  delivery.send.mockResolvedValue({});delivery.confirm.mockResolvedValue({});delivery.remove.mockResolvedValue({});
  write=jest.spyOn(ddb,'fencedSend').mockResolvedValue({});
  auth={verifyIdToken:jest.fn().mockResolvedValue({uid:'u',email:'user@example.com',auth_time:Math.floor(Date.now()/1000)}),
    getUser:jest.fn().mockResolvedValue({uid:'u',email:'user@example.com',emailVerified:false}),updateUser:jest.fn().mockResolvedValue({})};
  firebase.getAuth.mockResolvedValue(auth);
  person={uid:'u',email:'user@example.com',verified:false,auth};
});
afterEach(()=>write.mockRestore());
afterAll(()=>db.restore());
test('sender configuration fails closed before allocating a code or sending email',async()=>{
  delivery.configured.mockRejectedValue(Error('unavailable'));
  expect((await endpoint.send(event())).statusCode).toBe(503);expect(delivery.send).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
});
test.each([{}, {Authorization:'not-bearer'}])('OTP endpoints require a genuine Firebase bearer token',async headers=>{
  expect((await endpoint.send({...event(),headers})).statusCode).toBe(401);expect(delivery.send).not.toHaveBeenCalled();
});
test('revoked tokens cannot request codes',async()=>{
  auth.verifyIdToken.mockRejectedValue({code:'auth/id-token-revoked'});
  expect((await endpoint.send(event())).statusCode).toBe(401);expect(auth.verifyIdToken).toHaveBeenCalledWith('test-token',true);
});
test('stale login and mismatched mailbox are rejected',async()=>{
  auth.verifyIdToken.mockResolvedValue({uid:'u',email:'user@example.com',auth_time:Date.now()/1000-901});
  expect((await endpoint.send(event())).statusCode).toBe(401);
  auth.verifyIdToken.mockResolvedValue({uid:'u',email:'other@example.com',auth_time:Date.now()/1000});
  expect((await endpoint.send(event())).statusCode).toBe(401);
});
test('provider codes are sent only to the authenticated mailbox and never returned or stored',async()=>{
  const result=await endpoint.send(event({email:'victim@example.com',userId:'victim'}));
  expect(result.statusCode).toBe(200);
  const row=saved(),code=deliveredCode();
  expect(row).toMatchObject({email:'user@example.com',attempts:0,status:'SENDING'});
  expect(row.codeHash).toBeUndefined();expect(row.code).toBeUndefined();
  expect(row.expiresAt-Math.floor(Date.now()/1000)).toBeLessThanOrEqual(300);
  expect(result.body).not.toContain(code);expect(result.headers['Cache-Control']).toBe('no-store');
  expect(delivery.send).toHaveBeenCalledWith('u','user@example.com');
  const writes=write.mock.calls[0][0].input.TransactItems;
  expect(writes[0].Update.ExpressionAttributeValues[':limit']).toBe(40);
  expect(writes[1].Update.ExpressionAttributeValues[':limit']).toBe(20);
});
test('a cooldown returns the active challenge without sending another email',async()=>{
  await otp.issue(person,'ip');const row=saved();delivery.send.mockClear();write.mockClear();
  db.on(GetCommand).resolves({Item:{...row,status:'SENT'}});
  expect(await otp.issue(person,'ip')).toMatchObject({challengeId:row.challengeId,alreadySent:true});
  expect(delivery.send).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
});
test('hourly resend cap applies after cooldown',async()=>{
  db.on(GetCommand).resolves({Item:{hour:Math.floor(Date.now()/3600000),sends:5,resendAt:0}});
  await expect(otp.issue(person,'ip')).rejects.toMatchObject({statusCode:429});expect(delivery.send).not.toHaveBeenCalled();
});
test('provider failure never reports that a code was sent',async()=>{
  delivery.send.mockRejectedValue(Error('controlled provider error'));
  const result=await endpoint.send(event());expect(result.statusCode).toBe(503);
  expect(JSON.parse(result.body).code).toBe('OTP_DELIVERY_FAILED');
  expect(write.mock.calls.at(-1)[0].input.ExpressionAttributeValues[':next']).toBe('DELIVERY_FAILED');
});
test('a managed sender quota error produces an honest rate-limit response',async()=>{
  delivery.send.mockRejectedValue({name:'LimitExceededException'});
  const result=await endpoint.send(event());
  expect(result.statusCode).toBe(429);expect(JSON.parse(result.body).code).toBe('OTP_RATE_LIMITED');
});
test.each(['expired','attempts','wrong-mailbox','wrong-challenge','consumed'])('%s challenge cannot verify an account',async kind=>{
  await otp.issue(person,'ip');const row={...saved(),status:'SENT'};
  if(kind==='expired')row.expiresAt=0;
  if(kind==='attempts')row.attempts=5;
  if(kind==='wrong-mailbox')row.email='other@example.com';
  if(kind==='consumed')row.status='CONSUMED';
  db.on(GetCommand).resolves({Item:row});write.mockClear();
  await expect(otp.verify(person,kind==='wrong-challenge'?'f'.repeat(32):row.challengeId,'123456')).rejects.toMatchObject({statusCode:kind==='attempts'?429:400});
  expect(auth.updateUser).not.toHaveBeenCalled();expect(write).not.toHaveBeenCalled();
});
test('wrong guesses reserve an attempt before comparison and do not mark Firebase verified',async()=>{
  await otp.issue(person,'ip');const row={...saved(),status:'SENT'},code=deliveredCode();
  db.on(GetCommand).resolves({Item:row});write.mockClear();
  delivery.confirm.mockRejectedValue({name:'CodeMismatchException'});
  await expect(otp.verify(person,row.challengeId,code==='000000'?'111111':'000000')).rejects.toMatchObject({code:'OTP_INVALID_OR_EXPIRED'});
  expect(write.mock.calls[0][0]).toBeInstanceOf(TransactWriteCommand);
  expect(write.mock.calls[0][0].input.TransactItems[0].Update.ExpressionAttributeValues[':limit']).toBe(20);
  expect(auth.updateUser).not.toHaveBeenCalled();
});
test('correct code is consumed before marking exactly that mailbox verified',async()=>{
  await otp.issue(person,'ip');const row={...saved(),status:'SENT'},code=deliveredCode();
  db.on(GetCommand).resolves({Item:row});write.mockClear();
  expect(await otp.verify(person,row.challengeId,code)).toEqual({verified:true});
  expect(write.mock.calls[1][0]).toBeInstanceOf(UpdateCommand);
  expect(write.mock.calls[1][0].input.ExpressionAttributeValues[':consumed']).toBe('CONSUMED');
  expect(auth.updateUser).toHaveBeenCalledWith('u',{email:'user@example.com',emailVerified:true});
});
test('a lost concurrent consume race never marks another delivery verified',async()=>{
  await otp.issue(person,'ip');const row={...saved(),status:'SENT'},code=deliveredCode();
  db.on(GetCommand).resolves({Item:row});write.mockClear();
  write.mockResolvedValueOnce({}).mockRejectedValueOnce({name:'ConditionalCheckFailedException'});
  await expect(otp.verify(person,row.challengeId,code)).rejects.toMatchObject({statusCode:400});
  expect(auth.updateUser).not.toHaveBeenCalled();
});
test('SAM uses the built-in AWS sender and a confidential server client',()=>{
  const t=require('../../../audit/read-cfn.cjs')(require('fs').readFileSync(require('path').join(__dirname,'../../template.yaml'),'utf8'));
  for(const id of ['SendEmailOtpFunction','VerifyEmailOtpFunction'])expect(t.Resources[id].Properties.Events.Api.Properties.Auth.Authorizer).toBe('NONE');
  expect(t.Resources.EmailOtpTable.Properties.TimeToLiveSpecification.Enabled).toBe(true);
  expect(t.Resources.EmailOtpPool.Properties.EmailConfiguration).toEqual({EmailSendingAccount:'COGNITO_DEFAULT'});
  expect(t.Resources.EmailOtpClient.Properties.GenerateSecret).toBe(true);
  expect(t.Parameters.EmailOtpDailyLimit.Default).toBe(40);
});

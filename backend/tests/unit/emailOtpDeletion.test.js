jest.mock('../../src/lib/dynamodb',()=>({delete:jest.fn(),batchWrite:jest.fn(),docClient:{send:jest.fn()}}));
jest.mock('../../src/lib/emailOtpDelivery',()=>({remove:jest.fn()}));
jest.mock('../../src/lib/s3',()=>({}));
jest.mock('../../src/models/wsConnection',()=>({deactivateConnectionsByUserId:jest.fn()}));
jest.mock('../../src/models/resume',()=>({getResumesByUserId:jest.fn()}));
const ddb=require('../../src/lib/dynamodb'),delivery=require('../../src/lib/emailOtpDelivery');
const {deleteAllUserData}=require('../../src/lib/accountDeletion');
const completed=new Proxy({},{get:(_,category)=>category!=='emailOtp'});
beforeEach(()=>{
  jest.clearAllMocks();process.env.EMAIL_OTP_TABLE='otp-test';
  delivery.remove.mockResolvedValue(undefined);ddb.delete.mockResolvedValue({success:true});
  ddb.batchWrite.mockResolvedValue({success:true});
  ddb.docClient.send.mockResolvedValue({Items:[{id:'VERIFY#u#hour',userId:'u'}]});
});
afterAll(()=>delete process.env.EMAIL_OTP_TABLE);
test('account deletion purges auxiliary identity, current code state and user-owned counters',async()=>{
  const result=await deleteAllUserData('u',{completed});expect(result.failures).toEqual([]);
  expect(delivery.remove).toHaveBeenCalledWith('u');
  expect(ddb.delete).toHaveBeenCalledWith('otp-test',{id:'USER#u'});
  expect(ddb.docClient.send.mock.calls[0][0].input).toMatchObject({TableName:'otp-test',FilterExpression:'userId = :uid',ExpressionAttributeValues:{':uid':'u'}});
  expect(ddb.batchWrite).toHaveBeenCalledWith('otp-test',[],[{id:'VERIFY#u#hour'}]);
});
test('an auxiliary identity purge failure retains a failed deletion category for retry',async()=>{
  delivery.remove.mockRejectedValue(Error('controlled outage'));
  const result=await deleteAllUserData('u',{completed});
  expect(result.failures).toEqual(['emailOtp: controlled outage']);
  expect(ddb.delete).not.toHaveBeenCalled();
});

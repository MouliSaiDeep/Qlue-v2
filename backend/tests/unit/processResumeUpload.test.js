const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { mockClient } = require('aws-sdk-client-mock');
jest.mock('../../src/lib/dynamodb');
jest.mock('../../src/lib/bedrock');
jest.mock('../../src/models/resume');
jest.mock('../../src/models/user');
jest.mock('../../src/lib/s3', () => ({headObject:jest.fn()}));
jest.mock('../../src/lib/textract', () => ({extractTextFromPdf:jest.fn()}));
const resumes = require('../../src/models/resume');
const textract = require('../../src/lib/textract');
const s3 = require('../../src/lib/s3');
const {invokeModel} = require('../../src/lib/bedrock');
const {handler} = require('../../src/handlers/resume/processResumeUpload');
const lambda = mockClient(LambdaClient);
const request = {body:JSON.stringify({resumeId:'r'}),requestContext:{authorizer:{uid:'u'}}};
const worker = {isAsyncWorker:true,resumeId:'r',userId:'u',s3Key:'resumes/u/r.pdf',parseAttemptId:'attempt'};
beforeEach(() => {
  jest.clearAllMocks();lambda.reset();lambda.on(InvokeCommand).resolves({StatusCode:202});
  resumes.getResumeById.mockResolvedValue({resumeId:'r',userId:'u',s3Key:worker.s3Key,status:'UPLOADING'});
  resumes.claimResumeParse.mockResolvedValue({claimed:true,attemptId:'attempt'});
  resumes.claimResumeExecution.mockResolvedValue({claimed:true,owner:'owner',record:{parseVersion:'v1'}});
  resumes.updateResumeParsingResult.mockResolvedValue({success:true});
  resumes.getResumesByUserId.mockResolvedValue([]);
  s3.headObject.mockResolvedValue({versionId:'v1',contentLength:1000});
  textract.extractTextFromPdf.mockResolvedValue('A resume with enough words to successfully extract work experience skills education and contact information.');
  invokeModel.mockResolvedValue({content:[{text:JSON.stringify({name:'Person',skills:[]})}]});
  delete process.env.QLUE_PAID_OPS_DISABLED;delete process.env.PAID_OPS_SWITCH_PARAMETER;
});
afterAll(() => lambda.restore());
test('missing resume ID is rejected',async()=>expect((await handler({body:'{}'})).statusCode).toBe(400));
test('one claimed, version-pinned request invokes its stored worker payload',async()=>{
  expect((await handler(request)).statusCode).toBe(202);
  expect(resumes.claimResumeParse).toHaveBeenCalledWith('r','v1','u',expect.objectContaining({s3VersionId:'v1'}));
  const payload=JSON.parse(lambda.commandCalls(InvokeCommand)[0].args[0].input.Payload);
  expect(payload).toMatchObject({...worker,s3VersionId:'v1'});
});
test.each(['PARSING','PARSED'])('a repeated %s request needs no S3 read or worker invocation',async status=>{
  resumes.getResumeById.mockResolvedValue({userId:'u',status});
  expect((await handler(request)).statusCode).toBe(status==='PARSED'?200:202);
  expect(s3.headObject).not.toHaveBeenCalled();expect(lambda.calls()).toHaveLength(0);
});
test('a lost admission race starts no duplicate worker',async()=>{
  resumes.claimResumeParse.mockResolvedValue({claimed:false});
  expect((await handler(request)).statusCode).toBe(202);expect(lambda.calls()).toHaveLength(0);
});
test.each([{versionId:'v1',contentLength:11*1024*1024},{versionId:'null',contentLength:1000},null])(
  'invalid storage or real object size is rejected before admission',async meta=>{
    s3.headObject.mockResolvedValue(meta);expect((await handler(request)).statusCode).toBe(400);
    expect(resumes.claimResumeParse).not.toHaveBeenCalled();expect(lambda.calls()).toHaveLength(0);
  });
test('stop switch blocks new admission before S3 reads',async()=>{
  process.env.QLUE_PAID_OPS_DISABLED='all';expect((await handler(request)).statusCode).toBe(503);
  expect(s3.headObject).not.toHaveBeenCalled();
});
test('an unaccepted delivery surfaces failure while the durable claim remains recoverable',async()=>{
  lambda.on(InvokeCommand).resolves({StatusCode:500});expect((await handler(request)).statusCode).toBe(500);
  expect(resumes.updateResumeParsingResult).not.toHaveBeenCalled();
});
test('only the lease owner extracts pinned text and commits parsed data',async()=>{
  await handler(worker);
  expect(textract.extractTextFromPdf).toHaveBeenCalledWith(expect.any(String),worker.s3Key,
    expect.objectContaining({versionId:'v1',maxPages:15,clientRequestToken:expect.stringMatching(/^[a-f0-9]{64}$/)}));
  expect(resumes.updateResumeParsingResult).toHaveBeenCalledWith('r','PARSED',expect.any(Object),null,'u','attempt',{leaseOwner:'owner'});
});
test('duplicate or stale async deliveries perform no paid work',async()=>{
  resumes.claimResumeExecution.mockResolvedValue({claimed:false});await handler(worker);
  expect(textract.extractTextFromPdf).not.toHaveBeenCalled();expect(invokeModel).not.toHaveBeenCalled();
});
test('rejected PDFs never reach the AI parser',async()=>{
  textract.extractTextFromPdf.mockRejectedValue(Error('Invalid PDF'));await handler(worker);
  expect(invokeModel).not.toHaveBeenCalled();
  expect(resumes.updateResumeParsingResult).toHaveBeenCalledWith('r','FAILED',null,'Invalid PDF','u','attempt',{leaseOwner:'owner'});
});
test('a stale final commit performs no profile writes',async()=>{
  resumes.updateResumeParsingResult.mockResolvedValue({success:true,skipped:true});await handler(worker);
  expect(resumes.getResumesByUserId).not.toHaveBeenCalled();
});
test('a profile/index outage after parsing preserves the successful paid result',async()=>{
  resumes.getResumesByUserId.mockRejectedValue(Error('Index unavailable'));await handler(worker);
  expect(resumes.updateResumeParsingResult).toHaveBeenCalledTimes(1);
  expect(resumes.updateResumeParsingResult.mock.calls[0][1]).toBe('PARSED');
});

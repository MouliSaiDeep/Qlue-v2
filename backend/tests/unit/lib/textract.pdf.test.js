const {mockClient}=require('aws-sdk-client-mock');
const {TextractClient,StartDocumentTextDetectionCommand,GetDocumentTextDetectionCommand}=require('@aws-sdk/client-textract');
jest.mock('../../../src/lib/paidWork',()=>({assertRuntimeEnabled:jest.fn(),beforePaidCall:jest.fn()}));
jest.mock('../../../src/lib/s3',()=>({headObject:jest.fn(),getObject:jest.fn()}));
const s3=require('../../../src/lib/s3'),paid=require('../../../src/lib/paidWork');
const textract=require('../../../src/lib/textract');
const {realPdf}=require('../../fixtures/realPdf');
const transport=mockClient(TextractClient);
beforeEach(()=>{
  jest.clearAllMocks();transport.reset();
  s3.headObject.mockResolvedValue({versionId:'validated-version',contentLength:1000});
});
afterAll(()=>transport.restore());
test.each(['junk','pages','bytes','unversioned'])('%s PDF never consumes a provider attempt or starts OCR',async kind=>{
  s3.getObject.mockResolvedValue(kind==='pages'?await realPdf(16):Buffer.from('%PDF-junk'));
  if(kind==='bytes')s3.headObject.mockResolvedValue({versionId:'v1',contentLength:11*1024*1024});
  if(kind==='unversioned')s3.headObject.mockResolvedValue({versionId:'null',contentLength:1000});
  await expect(textract.extractTextFromPdf('bucket','key')).rejects.toMatchObject({statusCode:400});
  expect(paid.beforePaidCall).not.toHaveBeenCalled();expect(transport.calls()).toHaveLength(0);
});
test('real PDF validation pins both the download and OCR to the same S3 version',async()=>{
  s3.getObject.mockResolvedValue(await realPdf());
  transport.on(StartDocumentTextDetectionCommand).resolves({JobId:'ocr-job'});
  transport.on(GetDocumentTextDetectionCommand).resolves({JobStatus:'SUCCEEDED',Blocks:[{BlockType:'LINE',Text:'Resume text'}]});
  expect(await textract.extractTextFromPdf('bucket','key',{versionId:'validated-version',clientRequestToken:'attempt-token'})).toBe('Resume text');
  expect(s3.getObject).toHaveBeenCalledWith('bucket','key','validated-version',expect.any(Object));
  expect(transport.commandCalls(StartDocumentTextDetectionCommand)[0].args[0].input).toEqual({
    DocumentLocation:{S3Object:{Bucket:'bucket',Name:'key',Version:'validated-version'}},ClientRequestToken:'attempt-token'
  });
  expect(paid.beforePaidCall).toHaveBeenCalledTimes(1);
  expect(transport.commandCalls(GetDocumentTextDetectionCommand)).toHaveLength(1);
});

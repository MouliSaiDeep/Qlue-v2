const {mockClient}=require('aws-sdk-client-mock');
const {TextractClient,StartDocumentAnalysisCommand,StartDocumentTextDetectionCommand,GetDocumentAnalysisCommand}=require('@aws-sdk/client-textract');
const transport=mockClient(TextractClient);
jest.mock('../../../src/lib/paidWork',()=>({beforePaidCall:jest.fn()}));
const {beforePaidCall}=require('../../../src/lib/paidWork');
const textract=require('../../../src/lib/textract');

beforeEach(()=>{transport.reset();jest.clearAllMocks();beforePaidCall.mockResolvedValue(undefined);});
afterAll(()=>transport.restore());

test.each([[StartDocumentAnalysisCommand,'resumeParse'],[StartDocumentTextDetectionCommand,'jdAnalysis']])(
  'a blocked %p never starts a billed OCR job',async(Command,action)=>{
    beforePaidCall.mockRejectedValue(Object.assign(Error('paused'),{code:'SERVICE_PAUSED'}));
    await expect(textract.guardedSend(new Command({}))).rejects.toMatchObject({code:'SERVICE_PAUSED'});
    expect(beforePaidCall).toHaveBeenCalledWith(action);
    expect(transport.calls()).toHaveLength(0);
  }
);
test('each paid start is admitted before transport; result polling does not consume another provider attempt',async()=>{
  const order=[];beforePaidCall.mockImplementation(async()=>order.push('budget'));
  transport.on(StartDocumentAnalysisCommand).callsFake(()=>{order.push('provider');return {JobId:'job'};});
  transport.on(GetDocumentAnalysisCommand).resolves({JobStatus:'SUCCEEDED'});
  await textract.guardedSend(new StartDocumentAnalysisCommand({}));
  await textract.guardedSend(new GetDocumentAnalysisCommand({JobId:'job'}));
  expect(order).toEqual(['budget','provider']);expect(beforePaidCall).toHaveBeenCalledTimes(1);
  expect(await textract.config.maxAttempts()).toBe(1);
});

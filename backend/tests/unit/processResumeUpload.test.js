const { LambdaClient, InvokeCommand } = require("@aws-sdk/client-lambda");
const { mockClient } = require("aws-sdk-client-mock");
const { StartDocumentAnalysisCommand, GetDocumentAnalysisCommand, TextractClient } = require("@aws-sdk/client-textract");
const textractClient = require('../../src/lib/textract');
const { invokeModel } = require('../../src/lib/bedrock');
const { updateResumeParsingResult, getResumeById, getResumesByUserId } = require('../../src/models/resume');
const { setActiveResumeId } = require('../../src/models/user');
const { update } = require('../../src/lib/dynamodb');
const { handler } = require('../../src/handlers/resume/processResumeUpload');

const lambdaMock = mockClient(LambdaClient);
const textractMock = mockClient(TextractClient);

jest.mock('../../src/lib/dynamodb');
jest.mock('../../src/lib/bedrock');
jest.mock('../../src/models/resume');
jest.mock('../../src/models/user');
jest.mock('../../src/lib/textract', () => ({
  send: jest.fn()
}));

// Mock sleep
jest.setTimeout(30000);

describe('processResumeUpload handler', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    lambdaMock.reset();
    textractMock.reset();
    jest.clearAllMocks();
    process.env = { ...originalEnv, RESUMES_TABLE: 'test-table', RESUMES_BUCKET: 'test-bucket' };
  });

  afterAll(() => {
    process.env = originalEnv;
  });

  it('should return 400 if resumeId is missing', async () => {
    const event = {
      body: JSON.stringify({})
    };

    const result = await handler(event);

    expect(result.statusCode).toBe(400);
    expect(JSON.parse(result.body).error).toBe('resumeId is required');
  });

  it('should return 202 and trigger async worker on valid request', async () => {
    const event = {
      body: JSON.stringify({ resumeId: 'test-resume-id' }),
      requestContext: { authorizer: { uid: 'test-user-id' } }
    };

    getResumeById.mockResolvedValue({
      resumeId: 'test-resume-id',
      userId: 'test-user-id',
      s3Key: 'resumes/test.pdf'
    });

    lambdaMock.on(InvokeCommand).resolves({});

    const result = await handler(event);

    expect(result.statusCode).toBe(202);
    expect(updateResumeParsingResult).toHaveBeenCalledWith('test-resume-id', 'PARSING');
    expect(lambdaMock.commandCalls(InvokeCommand).length).toBe(1);
  });

  it('should handle async worker invocation', async () => {
    const event = {
      isAsyncWorker: true,
      resumeId: 'test-resume-id',
      userId: 'test-user-id',
      s3Key: 'resumes/test.pdf'
    };

    // Mock Textract Start
    textractClient.send.mockResolvedValueOnce({ JobId: 'test-job-id' });
    
    // Mock Textract Polling (Succeeded)
    textractClient.send.mockResolvedValueOnce({ JobStatus: 'SUCCEEDED' });
    
    // Mock Textract Result Collection
    textractClient.send.mockResolvedValueOnce({
      Blocks: [
        { BlockType: 'LINE', Text: 'Experience 1: Software Engineer at Company X for 5 years.' },
        { BlockType: 'LINE', Text: 'Skills include JavaScript, Node.js, AWS, and Flutter development.' },
        { BlockType: 'LINE', Text: 'Education: Bachelor of Science in Computer Science from University Y.' }
      ]
    });

    // Mock Bedrock
    invokeModel.mockResolvedValue({
      content: [{ text: JSON.stringify({ name: 'John Doe', skills: ['Skill A'] }) }]
    });

    getResumesByUserId.mockResolvedValue([{ resumeId: 'test-resume-id' }]);

    await handler(event);

    expect(updateResumeParsingResult).toHaveBeenCalledWith('test-resume-id', 'PARSED', expect.any(Object));
  });
});

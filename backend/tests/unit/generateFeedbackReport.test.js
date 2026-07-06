/**
 * Tests for generateFeedbackReport.
 *
 * Rewritten to match the actual architecture: this handler builds the report
 * and asynchronously invokes the STORE_FEEDBACK_LAMBDA (which owns persistence
 * and notifications). The previous test targeted an obsolete design where this
 * handler wrote to DynamoDB directly, so it could never pass.
 */
const { invokeModel, buildFeedbackPrompt } = require('../../src/lib/bedrock');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { mockClient } = require('aws-sdk-client-mock');
const { handler } = require('../../src/handlers/feedback/generateFeedbackReport');

const lambdaMock = mockClient(LambdaClient);

jest.mock('../../src/lib/bedrock');

describe('generateFeedbackReport handler', () => {
  beforeEach(() => {
    lambdaMock.reset();
    jest.clearAllMocks();
    process.env.FEEDBACK_MODEL_ID = 'test-feedback-model';
    buildFeedbackPrompt.mockReturnValue({ messages: [] });
  });

  const parsePayload = (call) => JSON.parse(Buffer.from(call.args[0].input.Payload).toString());

  it('should generate report and invoke the store lambda with the full payload', async () => {
    const event = {
      sessionId: 'session123',
      userId: 'user123',
      moduleType: 'RESUME',
      transcript: 'Interview transcript...',
      dimensionScores: { technical: 85 }
    };

    invokeModel.mockResolvedValue({
      content: [{ text: JSON.stringify({ strengths: ['Skill A'], improvements: ['Skill B'], summary: 'Good job' }) }],
      usage: { input_tokens: 100, output_tokens: 50 }
    });
    lambdaMock.on(InvokeCommand).resolves({});

    const result = await handler(event);

    expect(result.success).toBe(true);
    expect(result.sessionId).toBe('session123');
    expect(invokeModel).toHaveBeenCalled();
    expect(lambdaMock.calls()).toHaveLength(1);

    const payload = parsePayload(lambdaMock.call(0));
    expect(payload.sessionId).toBe('session123');
    expect(payload.overallScore).toBe(85);
    expect(payload.strengths).toEqual(['Skill A']);
    expect(payload.weaknesses).toEqual(['Skill B']);
    expect(payload.executiveSummary).toBe('Good job');
    expect(lambdaMock.call(0).args[0].input.InvocationType).toBe('Event');
  });

  it('should handle Bedrock parsing failure gracefully (even without dimensionScores)', async () => {
    const event = {
      sessionId: 'session123',
      userId: 'user123',
      moduleType: 'RESUME',
      transcript: 'Interview transcript...'
      // no dimensionScores — previously crashed with TypeError
    };

    invokeModel.mockResolvedValue({
      content: [{ text: 'INVALID JSON RESPONSE' }]
    });
    lambdaMock.on(InvokeCommand).resolves({});

    const result = await handler(event);

    expect(result.success).toBe(true);
    const payload = parsePayload(lambdaMock.call(0));
    expect(payload.strengths).toEqual(
      expect.arrayContaining(['Unable to extract specific strengths from this session.'])
    );
    expect(payload.overallScore).toBe(0);
    expect(payload.dimensionScores).toEqual({});
  });

  it('should throw if triggering the store lambda fails', async () => {
    const event = {
      sessionId: 'session123',
      userId: 'user123',
      moduleType: 'RESUME',
      dimensionScores: { technical: 50 }
    };

    invokeModel.mockResolvedValue({ content: [{ text: '{}' }] });
    lambdaMock.on(InvokeCommand).rejects(new Error('Storage error'));

    await expect(handler(event)).rejects.toThrow('Storage error');
  });
});

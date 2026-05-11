const { invokeModel, buildFeedbackPrompt } = require('../../src/lib/bedrock');
const { createFeedbackReport } = require('../../src/models/feedback');
const { updateSessionState, INTERVIEW_STATES } = require('../../src/models/session');
const { LambdaClient, InvokeCommand } = require('@aws-sdk/client-lambda');
const { mockClient } = require("aws-sdk-client-mock");
const { handler } = require('../../src/handlers/feedback/generateFeedbackReport');

const lambdaMock = mockClient(LambdaClient);

jest.mock('../../src/lib/bedrock');
jest.mock('../../src/models/feedback');
jest.mock('../../src/models/session');
jest.mock('./computeModuleScores', () => ({
  handler: jest.fn().mockResolvedValue({ overallScore: 85, normalizedScores: { technical: 85 } })
}), { virtual: true });

describe('generateFeedbackReport handler', () => {
  beforeEach(() => {
    lambdaMock.reset();
    jest.clearAllMocks();
    process.env.FEEDBACK_MODEL_ID = 'test-feedback-model';
  });

  it('should generate and store feedback report successfully', async () => {
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

    createFeedbackReport.mockResolvedValue({ success: true, feedbackId: 'feedback123' });
    updateSessionState.mockResolvedValue(true);

    const result = await handler(event);

    expect(result.success).toBe(true);
    expect(result.feedbackId).toBe('feedback123');
    expect(invokeModel).toHaveBeenCalled();
    expect(createFeedbackReport).toHaveBeenCalled();
    expect(updateSessionState).toHaveBeenCalledWith('session123', INTERVIEW_STATES.TERMINATED, null, expect.objectContaining({
      overallScore: 85
    }));
  });

  it('should handle Bedrock parsing failure gracefully', async () => {
    const event = {
      sessionId: 'session123',
      userId: 'user123',
      moduleType: 'RESUME',
      transcript: 'Interview transcript...'
    };

    invokeModel.mockResolvedValue({
      content: [{ text: 'INVALID JSON RESPONSE' }]
    });

    createFeedbackReport.mockResolvedValue({ success: true, feedbackId: 'feedback123' });

    const result = await handler(event);

    expect(result.success).toBe(true);
    expect(createFeedbackReport).toHaveBeenCalledWith(expect.objectContaining({
      strengths: expect.arrayContaining(['Unable to extract specific strengths from this session.'])
    }));
  });

  it('should throw error if storage fails', async () => {
    const event = {
      sessionId: 'session123',
      userId: 'user123',
      moduleType: 'RESUME'
    };

    invokeModel.mockResolvedValue({ content: [{ text: '{}' }] });
    createFeedbackReport.mockResolvedValue({ success: false, error: { message: 'Storage error' } });

    await expect(handler(event)).rejects.toThrow('Failed to store feedback: Storage error');
  });
});

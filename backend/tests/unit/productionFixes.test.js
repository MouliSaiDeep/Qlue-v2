/**
 * Regression tests for the production-readiness audit fixes.
 */

describe('exit-intent detection (processUserInput)', () => {
  const { getSessionById, updateSessionState } = require('../../src/models/session');
  const { saveTranscript } = require('../../src/models/transcript');
  const { handler } = require('../../src/handlers/interview/processUserInput');

  jest.mock('../../src/models/session');
  jest.mock('../../src/models/transcript');

  const submit = async (textTranscript) => {
    getSessionById.mockResolvedValue({ userId: 'u1', turnCount: 1, currentState: 'USER_RESPONDING' });
    saveTranscript.mockResolvedValue({});
    updateSessionState.mockResolvedValue({});
    const res = await handler({
      body: JSON.stringify({ sessionId: 's1', textTranscript }),
      requestContext: { authorizer: { uid: 'u1' } }
    });
    return JSON.parse(res.body);
  };

  beforeEach(() => jest.clearAllMocks());

  it('does not terminate on technical answers that merely contain exit substrings', async () => {
    // 'byte' contains 'bye'; 'stopped'/'nonstop' contain 'stop'
    expect((await submit('We serialize it into a byte array before writing to S3.')).shouldTerminate).toBe(false);
    expect((await submit('I stopped using Redis once the read volume dropped.')).shouldTerminate).toBe(false);
    expect((await submit('The pipeline runs nonstop across three regions.')).shouldTerminate).toBe(false);
    expect((await submit("That's all the traffic our load balancer handled in that quarter, roughly.")).shouldTerminate).toBe(false);
  });

  it('still terminates on a genuine, deliberate exit statement', async () => {
    expect((await submit("I'm done.")).shouldTerminate).toBe(true);
    expect((await submit('Please end the interview.')).shouldTerminate).toBe(true);
    expect((await submit('Goodbye')).shouldTerminate).toBe(true);
  });
});

describe('cleanAIResponse', () => {
  const { cleanAIResponse } = require('../../src/handlers/interview/generateQuestion');

  it('preserves the [OFFTOPIC] marker so the strike system can see it', () => {
    // Previously the stage-direction stripper ate the marker before the worker
    // ever checked for it, making the 3-strike system dead code.
    expect(cleanAIResponse('[OFFTOPIC] Let us get back on track. || What did you build?'))
      .toMatch(/^\[OFFTOPIC\]/);
  });

  it('does not truncate speech at the first colon', () => {
    expect(cleanAIResponse('My next question: what trade-offs did you weigh?'))
      .toBe('My next question: what trade-offs did you weigh?');
    expect(cleanAIResponse('We deploy at 9:00 every morning.'))
      .toBe('We deploy at 9:00 every morning.');
  });

  it('still strips genuine speaker labels', () => {
    expect(cleanAIResponse('Emma: Hello')).toBe('Hello');
    expect(cleanAIResponse('**Interviewer**: One more thing')).toBe('One more thing');
    expect(cleanAIResponse('Question: What is React?')).toBe('What is React?');
  });
});

describe('polly engine fallback', () => {
  const { PollyClient, SynthesizeSpeechCommand } = require('@aws-sdk/client-polly');
  const { mockClient } = require('aws-sdk-client-mock');
  const pollyMock = mockClient(PollyClient);
  const { synthesizeSpeech } = require('../../src/lib/polly');

  beforeEach(() => pollyMock.reset());
  afterEach(() => { delete process.env.POLLY_ALLOW_GENERATIVE; });

  it('gives up instead of recursing forever when every engine fails', async () => {
    // Ruth supports only neural/generative, so a 'standard' retry was remapped
    // straight back to 'neural' — the old fallback looped until the Lambda died.
    pollyMock.on(SynthesizeSpeechCommand).rejects(new Error('Polly unavailable'));

    await expect(synthesizeSpeech('hello there', 'Ruth', 'neural')).rejects.toThrow('Polly unavailable');
    expect(pollyMock.calls().length).toBeLessThanOrEqual(4);
  });
});

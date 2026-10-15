beforeEach(() => require('../../src/lib/dynamodb').docClient.send.mockResolvedValue({}));
jest.mock('../../src/lib/bedrock');
jest.mock('../../src/models/session');
jest.mock('../../src/lib/dynamodb', () => ({ docClient: { send: jest.fn(async () => ({ Items: [] })) } }));
jest.mock('../../src/lib/polly', () => ({ synthesizeSpeech: jest.fn(async () => ({ audioBase64: '' })) }));
jest.mock('../../src/lib/websocket', () => ({ postToConnection: jest.fn(async () => true) }));
jest.mock('../../src/models/user', () => ({ getUserById: jest.fn(async () => ({ userId: 'u' })) }));
jest.mock('../../src/handlers/interview/terminateSession', () => ({ handler: jest.fn(async () => ({ statusCode: 200 })) }));
const bedrock = require('../../src/lib/bedrock');
const sessions = require('../../src/models/session');
const ws = require('../../src/lib/websocket');
const terminate = require('../../src/handlers/interview/terminateSession');
const { generateAtomicTurn } = require('../../src/handlers/interview/asyncWorker');
const run = stage => generateAtomicTurn({ sessionId: 's', connectionId: 'c', moduleType: 'INTRO', session: {
  sessionId: 's', userId: 'u', moduleType: 'INTRO', turnCount: 1, introStage: stage, currentState: 'LOADING_CONTEXT'
} });
beforeEach(() => {
  jest.clearAllMocks();
  sessions.updateSessionState.mockResolvedValue({});
  sessions.getSessionById.mockResolvedValue({ currentState: 'AI_SPEAKING' });
});
test('real question handler converts model error to 500; worker rejects without consuming coaching', async () => {
  bedrock.invokeModelStream.mockRejectedValue(new Error('model unavailable'));
  bedrock.invokeModel.mockRejectedValue(new Error('model unavailable'));
  await expect(run('AWAITING_FIRST_ATTEMPT')).rejects.toThrow();
  expect(sessions.updateSessionState).not.toHaveBeenCalled();
  expect(terminate.handler).not.toHaveBeenCalled();
  expect(ws.postToConnection.mock.calls.some(([, e]) => e.type === 'turn_complete')).toBe(false);
});
test.each(['', '{}', '   '])('empty or malformed output %p never consumes coaching', async text => {
  bedrock.invokeModelStream.mockResolvedValue(text);
  bedrock.invokeModel.mockResolvedValue({ content: [{ text }] });
  await expect(run('AWAITING_FIRST_ATTEMPT')).rejects.toThrow();
  expect(sessions.updateSessionState).not.toHaveBeenCalled();
});
test.each(['Tell me more about your experience?', 'Please try your introduction again.', ''])('invalid closing %p uses deterministic answer-free fallback', async text => {
  bedrock.invokeModelStream.mockResolvedValue(text);
  bedrock.invokeModel.mockResolvedValue({ content: [{ text }] });
  await run('AWAITING_REVISED_ATTEMPT');
  const turn = ws.postToConnection.mock.calls.find(([, e]) => e.type === 'turn_complete')[1].payload;
  expect(turn.expectsAnswer).toBe(false);
  expect(turn.questionText).not.toMatch(/\?|tell me|try.*again/i);
  expect(terminate.handler).toHaveBeenCalled();
});
test('HTTP failure then successful retry coaches once through real handler contract', async () => {
  bedrock.invokeModelStream.mockRejectedValue(new Error('retry'));
  bedrock.invokeModel.mockResolvedValue({ content: [{ text: 'Use a specific achievement, then repeat your introduction.' }] });
  await run('AWAITING_FIRST_ATTEMPT');
  expect(sessions.updateSessionState.mock.calls.filter(([, to]) => to === 'USER_RESPONDING')).toHaveLength(1);
  expect(terminate.handler).not.toHaveBeenCalled();
});
test('encoded question size is rejected before a canonical turn is committed',async()=>{
  const text='\u0001'.repeat(9000)+' Could you describe your achievement?';
  bedrock.invokeModelStream.mockResolvedValue(text);
  bedrock.invokeModel.mockResolvedValue({content:[{text}]});
  await expect(run('AWAITING_FIRST_ATTEMPT')).rejects.toThrow(/encoded delivery limit/);
  expect(sessions.updateSessionState).not.toHaveBeenCalled();
});

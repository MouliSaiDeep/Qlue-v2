const { createSession, claimFeedbackRegeneration, revertFeedbackRegeneration } = require('../../../src/models/session');
const { docClient } = require('../../../src/lib/dynamodb');
const { TransactWriteCommand, GetCommand, DeleteCommand, UpdateCommand } = require("@aws-sdk/lib-dynamodb");

jest.mock('../../../src/lib/dynamodb', () => ({
  fencedSend: jest.fn(),
  docClient: {
    send: jest.fn()
  }
}));

describe('Session Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('persists fragment recovery fields under the claimed state and job lease', async () => {
    const {updateSessionState, INTERVIEW_STATES} = require('../../../src/models/session');
    const {fencedSend} = require('../../../src/lib/dynamodb');
    fencedSend.mockResolvedValueOnce({Attributes:{fragmentRetries:2,fragmentIds:['a','b']}});
    await updateSessionState('s', INTERVIEW_STATES.LOADING_CONTEXT, INTERVIEW_STATES.LOADING_CONTEXT,
      {fragmentRetries:2,fragmentIds:['a','b'],expectedJobId:'job',guardUserId:'u'});
    expect(fencedSend.mock.calls[0][1]).toBe('u');
    const input=fencedSend.mock.calls[0][0].input;
    expect(input.UpdateExpression).toContain('fragmentRetries = :fragmentRetries');
    expect(input.UpdateExpression).toContain('fragmentIds = :fragmentIds');
    expect(input.ExpressionAttributeValues[':fragmentRetries']).toBe(2);
    expect(input.ExpressionAttributeValues[':fragmentIds']).toEqual(['a','b']);
    expect(input.ConditionExpression).toContain('currentState = :expectedCurrentState');
    expect(input.ConditionExpression).toContain('jobId = :expectedJobId');
  });

  it('should create a session and claim the active-session lock in one atomic transaction', async () => {
    docClient.send.mockResolvedValueOnce({});

    await createSession('sess-123', 'user-456', 'RESUME');

    expect(docClient.send).toHaveBeenCalledTimes(1);
    const commandCall = docClient.send.mock.calls[0][0];
    expect(commandCall).toBeInstanceOf(TransactWriteCommand);

    const items = commandCall.input.TransactItems;
    expect(items).toHaveLength(3);
    expect(items[0].ConditionCheck.Key).toEqual({userId:'user-456'});
    expect(items[0].ConditionCheck.ConditionExpression).toBe('attribute_not_exists(userId)');

    // First item: the session row, guarded by attribute_not_exists(sessionId).
    const sessionPut = items[1].Put;
    expect(sessionPut.ConditionExpression).toBe('attribute_not_exists(sessionId)');
    expect(sessionPut.Item.sessionId).toBe('sess-123');
    expect(sessionPut.Item.userId).toBe('user-456');
    expect(sessionPut.Item.moduleType).toBe('RESUME');
    expect(sessionPut.Item.activeMarker).toBe('ACTIVE');

    // Second item: the per-user lock row, also guarded by attribute_not_exists.
    const lockPut = items[2].Put;
    expect(lockPut.ConditionExpression).toBe('attribute_not_exists(sessionId)');
    expect(lockPut.Item.sessionId).toBe('LOCK#user-456');
    expect(lockPut.Item.lockedSessionId).toBe('sess-123');
    // The lock row carries no activeMarker/startedAt, so it stays out of both GSIs.
    expect(lockPut.Item.activeMarker).toBeUndefined();
    expect(lockPut.Item.startedAt).toBeUndefined();
  });

  it('should throw ACTIVE_SESSION_EXISTS when a valid lock is already held', async () => {
    // 1) atomic write is cancelled (lock row already present)
    docClient.send.mockRejectedValueOnce({ name: 'TransactionCanceledException' });
    // 2) reconcile reads the existing lock — points at a live session
    docClient.send.mockResolvedValueOnce({ Item: { lockedSessionId: 'other-sess', expiresAt: Math.floor(Date.now() / 1000) + 3600 } });
    // 3) getSession('other-sess') — still active, so the lock is NOT stale
    docClient.send.mockResolvedValueOnce({ Item: { sessionId: 'other-sess', currentState: 'AI_SPEAKING' } });

    await expect(createSession('sess-123', 'user-456', 'RESUME')).rejects.toMatchObject({
      code: 'ACTIVE_SESSION_EXISTS'
    });

    // No delete (lock was valid) and no retry transaction.
    const deletes = docClient.send.mock.calls.filter((c) => c[0] instanceof DeleteCommand);
    expect(deletes).toHaveLength(0);
  });

  it('should reconcile an orphaned lock and retry the create once', async () => {
    // 1) atomic write cancelled by a stale lock
    docClient.send.mockRejectedValueOnce({ name: 'TransactionCanceledException' });
    // 2) reconcile reads the existing lock
    docClient.send.mockResolvedValueOnce({ Item: { lockedSessionId: 'dead-sess', expiresAt: Math.floor(Date.now() / 1000) + 3600 } });
    // 3) getSession('dead-sess') — gone, so the lock is orphaned/stale
    docClient.send.mockResolvedValueOnce({});
    // 4) conditional delete of the orphaned lock
    docClient.send.mockResolvedValueOnce({});
    // 5) retried transaction succeeds
    docClient.send.mockResolvedValueOnce({});

    const session = await createSession('sess-123', 'user-456', 'RESUME');
    expect(session.sessionId).toBe('sess-123');

    const deletes = docClient.send.mock.calls.filter((c) => c[0] instanceof DeleteCommand);
    expect(deletes).toHaveLength(1);
    const transacts = docClient.send.mock.calls.filter((c) => c[0] instanceof TransactWriteCommand);
    expect(transacts).toHaveLength(2); // initial + retry
  });
});

describe('Session model deletion fencing', () => {
  it('never creates a session without an account tombstone ConditionCheck', async()=>{
    docClient.send.mockResolvedValue({});
    await createSession('new-session','deleted-account','INTRO');
    const txn=docClient.send.mock.calls.at(-1)[0].input.TransactItems;
    expect(txn[0].ConditionCheck).toEqual({TableName:'qlue-deletion-jobs',Key:{userId:'deleted-account'},ConditionExpression:'attribute_not_exists(userId)'});
  });
});

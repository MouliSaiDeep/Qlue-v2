const { createSession } = require('../../../src/models/session');
const { docClient } = require('../../../src/lib/dynamodb');
const { PutCommand } = require("@aws-sdk/lib-dynamodb");

jest.mock('../../../src/lib/dynamodb', () => ({
  docClient: {
    send: jest.fn()
  }
}));

describe('Session Model', () => {
  beforeEach(() => {
    jest.clearAllMocks();
  });

  it('should create a session enforcing attribute_not_exists', async () => {
    docClient.send.mockResolvedValueOnce({});

    await createSession('sess-123', 'user-456', 'RESUME');

    expect(docClient.send).toHaveBeenCalledTimes(1);
    const commandCall = docClient.send.mock.calls[0][0];
    expect(commandCall).toBeInstanceOf(PutCommand);
    expect(commandCall.input.ConditionExpression).toBe('attribute_not_exists(sessionId)');
    expect(commandCall.input.Item.sessionId).toBe('sess-123');
    expect(commandCall.input.Item.userId).toBe('user-456');
    expect(commandCall.input.Item.moduleType).toBe('RESUME');
  });
});

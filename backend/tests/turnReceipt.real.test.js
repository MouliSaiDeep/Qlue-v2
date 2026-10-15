jest.mock('../src/lib/dynamodb', () => ({ docClient: { send: jest.fn() } }));
const { docClient } = require('../src/lib/dynamodb');
const receipt = require('../src/lib/turnReceipt');

afterEach(() => jest.clearAllMocks());

test('real receipt lookup uses a consistent bounded DynamoDB read', async () => {
  const item = { fingerprint: 'answer', job: { jobId: 'one' } };
  docClient.send.mockResolvedValue({ Item: item });
  await expect(receipt.get('session', 'turn')).resolves.toEqual(item);
  const [command, options] = docClient.send.mock.calls[0];
  expect(command.input).toMatchObject({
    Key: { transcriptId: 'REQUEST#session#turn' }, ConsistentRead: true,
  });
  expect(options.abortSignal).toBeInstanceOf(AbortSignal);
});

test('missing receipt returns undefined and storage failures propagate', async () => {
  docClient.send.mockResolvedValueOnce({});
  await expect(receipt.get('session', 'missing')).resolves.toBeUndefined();
  docClient.send.mockRejectedValueOnce(new Error('storage unavailable'));
  await expect(receipt.get('session', 'turn')).rejects.toThrow('storage unavailable');
});

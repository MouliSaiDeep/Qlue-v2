const { docClient, get, put, update, query, scan, transactWrite } = require('../../../src/lib/dynamodb');
const { GetCommand, PutCommand, UpdateCommand, QueryCommand, ScanCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');

jest.mock('../../../src/lib/dynamodb', () => {
    const original = jest.requireActual('../../../src/lib/dynamodb');
    return {
        ...original,
        docClient: {
            send: jest.fn()
        }
    };
});

describe('dynamodb lib', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    it('get should return item on success', async () => {
        docClient.send.mockResolvedValue({ Item: { id: '1', name: 'test' } });
        const result = await get('test-table', { id: '1' });
        expect(result.success).toBe(true);
        expect(result.data).toEqual({ id: '1', name: 'test' });
    });

    it('get should return error on failure', async () => {
        docClient.send.mockRejectedValue(new Error('DDB error'));
        const result = await get('test-table', { id: '1' });
        expect(result.success).toBe(false);
        expect(result.error.message).toBe('DDB error');
    });

    it('put should send PutCommand', async () => {
        docClient.send.mockResolvedValue({});
        const result = await put('test-table', { id: '1', name: 'test' });
        expect(result.success).toBe(true);
        expect(docClient.send).toHaveBeenCalledWith(expect.any(PutCommand));
    });

    it('query should return items', async () => {
        docClient.send.mockResolvedValue({ Items: [{ id: '1' }] });
        const result = await query('test-table', 'id = :id', { values: { ':id': '1' } });
        expect(result.success).toBe(true);
        expect(result.data).toEqual([{ id: '1' }]);
    });

    it('transactWrite should send TransactWriteCommand', async () => {
        docClient.send.mockResolvedValue({});
        const result = await transactWrite([{ Put: { TableName: 't', Item: {} } }]);
        expect(result.success).toBe(true);
        expect(docClient.send).toHaveBeenCalledWith(expect.any(TransactWriteCommand));
    });

    it('should retry on ProvisionedThroughputExceededException', async () => {
        const error = new Error('Throughput exceeded');
        error.name = 'ProvisionedThroughputExceededException';
        
        docClient.send
            .mockRejectedValueOnce(error)
            .mockResolvedValueOnce({ Item: { id: '1' } });

        const result = await get('test-table', { id: '1' });
        expect(result.success).toBe(true);
        expect(docClient.send).toHaveBeenCalledTimes(2);
    }, 10000); // Increase timeout for retries
});

const { handler } = require('../../src/handlers/interview/asyncWorker');
const { getSessionById } = require('../../src/models/session');
const { postToConnection } = require('../../src/lib/websocket');

jest.mock('../../src/models/session');
jest.mock('../../src/lib/websocket');
jest.mock('../../src/handlers/interview/generateQuestion');
jest.mock('../../src/lib/polly');

describe('asyncWorker', () => {
    beforeEach(() => {
        jest.clearAllMocks();
    });

    test('should skip processing if session is not found', async () => {
        getSessionById.mockResolvedValue(null);

        const event = {
            Records: [
                {
                    body: JSON.stringify({
                        sessionId: 'non-existent',
                        action: 'session_init'
                    })
                }
            ]
        };

        await handler(event);

        expect(getSessionById).toHaveBeenCalledWith('non-existent');
        expect(postToConnection).not.toHaveBeenCalled();
    });

    test('should skip processing if session is in terminal state', async () => {
        getSessionById.mockResolvedValue({
            sessionId: 'session-123',
            currentState: 'TERMINATED'
        });

        const event = {
            Records: [
                {
                    body: JSON.stringify({
                        sessionId: 'session-123',
                        action: 'turn_submit'
                    })
                }
            ]
        };

        await handler(event);

        expect(getSessionById).toHaveBeenCalledWith('session-123');
        expect(postToConnection).not.toHaveBeenCalled();
    });
});

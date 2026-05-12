const { invokeModel, invokeModelStream, buildInterviewPrompt, buildScoringPrompt } = require('../../../src/lib/bedrock');
const { BedrockRuntimeClient, ConverseCommand, ConverseStreamCommand } = require('@aws-sdk/client-bedrock-runtime');
const { mockClient } = require('aws-sdk-client-mock');

const bedrockMock = mockClient(BedrockRuntimeClient);

describe('bedrock lib', () => {
    beforeEach(() => {
        bedrockMock.reset();
        jest.clearAllMocks();
    });

    it('invokeModel should return formatted response', async () => {
        bedrockMock.on(ConverseCommand).resolves({
            output: {
                message: {
                    content: [{ text: 'Hello' }]
                }
            },
            usage: { inputTokens: 10, outputTokens: 20 }
        });

        const result = await invokeModel('model-id', { messages: [] });
        expect(result.content[0].text).toBe('Hello');
        expect(result.usage.inputTokens).toBe(10);
    });

    it('invokeModel should retry on ThrottlingException', async () => {
        const error = new Error('Throttled');
        error.name = 'ThrottlingException';

        bedrockMock.on(ConverseCommand)
            .rejectsOnce(error)
            .resolves({ output: { message: { content: [{ text: 'Success' }] } } });

        const result = await invokeModel('model-id', { messages: [] });
        expect(result.content[0].text).toBe('Success');
        expect(bedrockMock.calls()).toHaveLength(2);
    }, 10000);

    it('invokeModelStream should aggregate tokens', async () => {
        const mockStream = {
            async *[Symbol.asyncIterator]() {
                yield { contentBlockDelta: { delta: { text: 'He' } } };
                yield { contentBlockDelta: { delta: { text: 'llo' } } };
            }
        };

        bedrockMock.on(ConverseStreamCommand).resolves({ stream: mockStream });

        const onToken = jest.fn();
        const result = await invokeModelStream('model-id', { messages: [] }, onToken);

        expect(result).toBe('Hello');
        expect(onToken).toHaveBeenCalledTimes(2);
        expect(onToken).toHaveBeenCalledWith('He');
        expect(onToken).toHaveBeenCalledWith('llo');
    });

    it('buildInterviewPrompt should create correct system message for HR', () => {
        const result = buildInterviewPrompt('context', [], 0, 'HR');
        expect(result.system).toContain('HR interviewer');
        expect(result.messages[0].role).toBe('user');
        expect(result.messages[0].content[0].text).toBe("Let's begin the interview.");
    });

    it('buildScoringPrompt should create correct scoring instructions', () => {
        const result = buildScoringPrompt('HR', 'User answer', ['communication']);
        expect(result.system).toContain('interview evaluator');
        expect(result.system).toContain('communication');
        expect(result.messages[0].content[0].text).toContain('User answer');
    });
});

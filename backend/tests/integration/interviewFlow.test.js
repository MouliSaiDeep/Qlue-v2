const { handler: initializeSession } = require('../../src/handlers/interview/initializeSession');
const { handler: processUserInput } = require('../../src/handlers/interview/processUserInput');
const { handler: generateFeedbackReport } = require('../../src/handlers/feedback/generateFeedbackReport');
const { DynamoDBDocumentClient, PutCommand, GetCommand, UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');
const { BedrockRuntimeClient, ConverseCommand } = require('@aws-sdk/client-bedrock-runtime');
const { mockClient } = require('aws-sdk-client-mock');

const ddbMock = mockClient(DynamoDBDocumentClient);
const bedrockMock = mockClient(BedrockRuntimeClient);

describe('Interview Flow Integration Test', () => {
    const userId = 'user-integration-123';
    let sessionId;
    let mockStore = {}; // Simulate DynamoDB state

    beforeEach(() => {
        ddbMock.reset();
        bedrockMock.reset();
        mockStore = {};

        // Mock DDB behavior to use mockStore
        ddbMock.on(PutCommand).callsFake((params) => {
            const table = params.TableName;
            const itemKey = params.Item.PK ? `${params.Item.PK}#${params.Item.SK}` : (params.Item.sessionId || params.Item.userId || params.Item.transcriptId);
            const key = `${table}:${itemKey}`;
            mockStore[key] = params.Item;
            return {};
        });

        ddbMock.on(GetCommand).callsFake((params) => {
            const table = params.TableName;
            const itemKey = params.Key.PK ? `${params.Key.PK}#${params.Key.SK}` : (params.Key.sessionId || params.Key.userId);
            const key = `${table}:${itemKey}`;
            return { Item: mockStore[key] };
        });

        ddbMock.on(UpdateCommand).callsFake((params) => {
            const table = params.TableName;
            const itemKey = params.Key.PK ? `${params.Key.PK}#${params.Key.SK}` : (params.Key.sessionId || params.Key.userId);
            const key = `${table}:${itemKey}`;
            if (!mockStore[key]) mockStore[key] = {};
            // Simplified update logic for testing
            if (params.UpdateExpression.includes('SET currentState = :newState')) {
                mockStore[key].currentState = params.ExpressionAttributeValues[':newState'];
            }
            if (params.UpdateExpression.includes('SET transcript = list_append')) {
                if (!mockStore[key].transcript) mockStore[key].transcript = [];
                mockStore[key].transcript.push(...params.ExpressionAttributeValues[':t']);
            }
            return { Attributes: mockStore[key] };
        });

        ddbMock.on(QueryCommand).callsFake((params) => {
            const table = params.TableName;
            // Mock query for session history, active session, or transcripts
            const items = Object.values(mockStore).filter(item => {
                // This is a bit loose since items in mockStore don't know their table,
                // but we can check the table prefix in the mockStore keys if we want.
                // For now, let's just filter by attributes.
                if (params.KeyConditionExpression.includes('PK = :pk')) {
                    return item.PK === params.ExpressionAttributeValues[':pk'];
                }
                if (params.KeyConditionExpression.includes('userId = :uid')) {
                    return item.userId === params.ExpressionAttributeValues[':uid'];
                }
                if (params.KeyConditionExpression.includes('sessionId = :sid')) {
                    return item.sessionId === params.ExpressionAttributeValues[':sid'];
                }
                return false;
            });
            return { Items: items };
        });
    });

    it('should complete a full interview lifecycle successfully', async () => {
        // 1. Initialize Session
        const initEvent = {
            requestContext: { authorizer: { uid: userId } },
            body: JSON.stringify({ moduleType: 'HR', voiceId: 'Tiffany' })
        };
        const initResult = await initializeSession(initEvent);
        const initBody = JSON.parse(initResult.body);
        sessionId = initBody.sessionId;

        expect(initResult.statusCode).toBe(200);
        expect(sessionId).toBeDefined();

        // 2. Process Turn 1 (User Intro)
        bedrockMock.on(ConverseCommand).resolves({
            output: {
                message: {
                    content: [{
                        text: JSON.stringify({
                            question: "Tell me about your experience with teamwork.",
                            analysis: "User introduced themselves."
                        })
                    }]
                }
            }
        });

        const turn1Event = {
            requestContext: { authorizer: { uid: userId } },
            body: JSON.stringify({
                sessionId,
                textTranscript: "I am a software engineer.",
                isSilence: false
            })
        };
        const turn1Result = await processUserInput(turn1Event);
        expect(turn1Result.statusCode).toBe(200);

        // 3. Process Turn 2 (User Answer)
        const turn2Event = {
            requestContext: { authorizer: { uid: userId } },
            body: JSON.stringify({
                sessionId,
                textTranscript: "I love working in teams and collaborate well.",
                isSilence: false
            })
        };
        const turn2Result = await processUserInput(turn2Event);
        expect(turn2Result.statusCode).toBe(200);

        // 4. Force Terminate (to trigger feedback)
        const sessionsTable = process.env.SESSIONS_TABLE || 'qlue-sessions';
        mockStore[`${sessionsTable}:${sessionId}`].currentState = 'TERMINATED';

        // 5. Generate Feedback Report
        // Mock scoring Bedrock call
        bedrockMock.on(ConverseCommand).resolves({
            output: {
                message: {
                    content: [{
                        text: JSON.stringify({
                            strengths: ["Communication"],
                            improvements: ["Be more specific"],
                            summary: "Great interview."
                        })
                    }]
                }
            },
            usage: { inputTokens: 100, outputTokens: 200 }
        });

        const feedbackEvent = {
            sessionId,
            userId,
            moduleType: 'HR',
            transcript: "USER: I am a software engineer.\n\nAI: Tell me about your experience with teamwork.\n\nUSER: I love working in teams and collaborate well.",
            dimensionScores: { teamwork: 80, communicationClarity: 90 },
            metadata: { turnCount: 2 }
        };
        const feedbackResult = await generateFeedbackReport(feedbackEvent);
        
        expect(feedbackResult.success).toBe(true);
        expect(mockStore[`${sessionsTable}:${sessionId}`].currentState).toBe('TERMINATED');
    });
});

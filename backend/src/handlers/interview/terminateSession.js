const { getSession } = require('../../models/session');
const { transitionState, INTERVIEW_STATES } = require('./controlTurnFlow');

/**
 * Handle concluding the interview session.
 */
exports.handler = async (event) => {
    try {
        const body = JSON.parse(event.body || '{}');
        const { sessionId, reason } = body; 
        // reason can be TIME_LIMIT, CONCEPTS_MASTERED, SILENCE_TIMEOUT, or USER_INITIATED

        const session = await getSession(sessionId);
        if (!session) throw new Error('Session not found');

        // Single atomic transition directly to TERMINATED
        // GENERATING_FEEDBACK is now handled asynchronously by the feedback pipeline
        await transitionState(sessionId, INTERVIEW_STATES.TERMINATED);

        // Define Closing Statement based on Reason
        let closingStatement = "Thank you for your time. That concludes our interview.";
        if (reason === 'TIME_LIMIT') {
            closingStatement = "We've reached the end of our allotted time. Thank you for your comprehensive answers. This concludes our interview.";
        } else if (reason === 'CONCEPTS_MASTERED') {
            closingStatement = "You've successfully covered all the learning concepts we set out to explore! Fantastic work. This concludes our session.";
        } else if (reason === 'SILENCE_TIMEOUT') {
            closingStatement = "I haven't heard anything for a while, so I will go ahead and close this session now. Thank you.";
        } else if (reason === 'USER_INITIATED') {
            closingStatement = "Understood. We will wrap up the interview here. Thank you for your time.";
        }


        // Ideally, here we trigger Rishi's SNS generation trigger
        const { SNSClient, PublishCommand } = require("@aws-sdk/client-sns");
        const sns = new SNSClient({});
        if (process.env.FEEDBACK_TOPIC_ARN) {
            try {
                await sns.send(new PublishCommand({ 
                    TopicArn: process.env.FEEDBACK_TOPIC_ARN, 
                    Message: JSON.stringify({
                        sessionId,
                        userId: session.userId,
                        moduleType: session.moduleType
                    }) 
                }));
            } catch (e) {
                console.error("SNS Publish Failed:", e);
            }
        }

        return {
            statusCode: 200,
            body: JSON.stringify({
                success: true,
                data: {
                    sessionId,
                    nextAIResponse: closingStatement,
                    onlyQuestion: closingStatement,
                    state: INTERVIEW_STATES.TERMINATED,
                    message: `Session terminated due to ${reason}`
                }
            })
        };

    } catch (err) {
        console.error('Termination Failed:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};

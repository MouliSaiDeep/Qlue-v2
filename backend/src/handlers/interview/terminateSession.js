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

        // Transition to GENERATING_FEEDBACK
        await transitionState(sessionId, INTERVIEW_STATES.GENERATING_FEEDBACK);

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
        // e.g. await sns.publish({ TopicArn: FEEDBACK_TOPIC, Message: JSON.stringify({sessionId}) })

        // Transition finally to TERMINATED since we're returning the closing statement
        await transitionState(sessionId, INTERVIEW_STATES.TERMINATED);

        return {
            statusCode: 200,
            body: JSON.stringify({
                sessionId,
                state: INTERVIEW_STATES.TERMINATED,
                closingStatement,
                message: `Session terminated due to ${reason}`
            })
        };

    } catch (err) {
        console.error('Termination Failed:', err);
        return { statusCode: 500, body: JSON.stringify({ error: err.message }) };
    }
};

const { docClient } = require('./session');
const { UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

const CONCEPTS_TABLE = process.env.CONCEPTS_TABLE_NAME || 'Concepts';

const CONCEPT_STATES = {
    UNADDRESSED: 'UNADDRESSED',
    TUTORED: 'TUTORED',
    MASTERED: 'MASTERED'
};

/**
 * Updates or creates a concept state in DynamoDB.
 */
async function updateConceptState(sessionId, conceptId, state, attemptIncrement = 1) {
    const command = new UpdateCommand({
        TableName: CONCEPTS_TABLE,
        Key: { sessionId, conceptId },
        UpdateExpression: 'SET #st = :state ADD attempts :inc',
        ExpressionAttributeNames: {
            '#st': 'state'
        },
        ExpressionAttributeValues: {
            ':state': state,
            ':inc': attemptIncrement
        },
        ReturnValues: 'ALL_NEW'
    });
    
    const res = await docClient.send(command);
    return res.Attributes;
}

/**
 * Retrieves all concepts for a given session.
 */
async function getConceptsBySession(sessionId) {
    const command = new QueryCommand({
        TableName: CONCEPTS_TABLE,
        KeyConditionExpression: 'sessionId = :sessionId',
        ExpressionAttributeValues: {
            ':sessionId': sessionId
        }
    });
    
    const res = await docClient.send(command);
    return res.Items || [];
}

module.exports = {
    CONCEPT_STATES,
    updateConceptState,
    getConceptsBySession
};

const diagnostics=require('../lib/logger').safeConsole;
const { docClient } = require('../lib/dynamodb');
const { UpdateCommand, QueryCommand } = require('@aws-sdk/lib-dynamodb');

// BE-BUG #12 FIX: was CONCEPTS_TABLE_NAME/'Concepts' — correct name is CONCEPT_STATES_TABLE/'qlue-concept-states'
const CONCEPTS_TABLE = process.env.CONCEPT_STATES_TABLE || 'qlue-concept-states';

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
        Key: { conceptId },
        UpdateExpression: 'SET #st = :state, sessionId = :sid ADD attempts :inc',
        ExpressionAttributeNames: {
            '#st': 'state'
        },
        ExpressionAttributeValues: {
            ':state': state,
            ':sid': sessionId,
            ':inc': attemptIncrement
        },
        ReturnValues: 'ALL_NEW'
    });
    
    const session = await require('./session').getSession(sessionId);
    if(!session?.userId) throw new Error('Concept parent session is gone');
    const res = await require('../lib/dynamodb').fencedSend(command,session.userId,[{ConditionCheck:{TableName:process.env.SESSIONS_TABLE||'qlue-sessions',Key:{sessionId},ConditionExpression:'attribute_exists(sessionId) AND currentState <> :ended',ExpressionAttributeValues:{':ended':'TERMINATED'}}}]);
    return res.Attributes;
}

/**
 * Retrieves all concepts for a given session.
 */
async function getConceptsBySession(sessionId) {
    const command = new QueryCommand({
        TableName: CONCEPTS_TABLE,
        IndexName: 'GSI_SessionIdConcept',
        KeyConditionExpression: 'sessionId = :sessionId',
        ExpressionAttributeValues: {
            ':sessionId': sessionId
        }
    });
    
    const res = await require('../lib/deadline').sendBounded(docClient,command);
    return res.Items || [];
}

/**
 * Selects the next appropriate concept for the Adaptive Tutor.
 * Prioritizes UNADDRESSED, then falls back to TUTORED if attempts < 3.
 */
async function selectNextConcept(sessionId) {
    const concepts = await getConceptsBySession(sessionId);
    if (!concepts || concepts.length === 0) return null;

    const unaddressed = concepts.find(c => c.state === CONCEPT_STATES.UNADDRESSED);
    if (unaddressed) return unaddressed;

    // Fall back to Tutored if we haven't exhausted attempts (max 3 tries)
    const tutored = concepts.find(c => c.state === CONCEPT_STATES.TUTORED && (c.attempts || 0) < 3);
    if (tutored) return tutored;

    // If everything is MASTERED or exhausted attempts
    return null;
}

/**
 * Validates external comprehension via Bedrock evaluation (Stubbed for Nithin's prompt integration)
 */
async function evaluateComprehension(sessionId, textTranscript, referenceMaterial) {
    const { invokeModel } = require('../lib/bedrock');
    
    // Nithin implements the exact prompt structure in lib/bedrock later.
    // Here we orchestrate the interaction logic.
    const promptParams = {
        prompt: `Evaluate if the following user explanation matches the reference material.\nReference: ${referenceMaterial}\nExplanation: ${textTranscript}`,
        task: 'COMPREHENSION_CHECK'
    };

    try {
        const result = await invokeModel(undefined, promptParams);
        return {
            status: parseInt(result.score || 0) >= 70 ? 'COMPREHENDED' : 'NOT_YET_COMPREHENDED',
            confidence: result.confidence || 0.8
        };
    } catch (err) {
        diagnostics.error('evaluateComprehension failed:', err);
        return { status: 'NOT_YET_COMPREHENDED', confidence: 0 };
    }
}

module.exports = {
    CONCEPT_STATES,
    updateConceptState,
    getConceptsBySession,
    selectNextConcept,
    evaluateComprehension
};

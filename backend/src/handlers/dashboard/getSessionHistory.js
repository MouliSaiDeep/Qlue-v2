const diagnostics=require('../../lib/logger').safeConsole;
const { DynamoDBClient } = require("@aws-sdk/client-dynamodb");
const { DynamoDBDocumentClient, QueryCommand } = require("@aws-sdk/lib-dynamodb");
const { encodeCursor, decodeCursor, buildStartKeyForUser } = require('../../lib/cursor');

const client = new DynamoDBClient({});
const docClient = DynamoDBDocumentClient.from(client);

const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions'; // BE-BUG #11 FIX: was SESSIONS_TABLE_NAME

const DEFAULT_LIMIT = 10;
const MAX_LIMIT = 50;

/**
 * Clamp the client-supplied page size to a bounded positive integer.
 * BE-BUG #18 FIX: `Limit: parseInt(limit)` accepted NaN (→ omitted Limit,
 * unbounded page), 0, negatives and absurd values straight from the query
 * string. Now: non-numeric/absent → default; otherwise clamped to [1, MAX].
 */
function resolveLimit(raw) {
  const n = parseInt(raw, 10);
  if (!Number.isFinite(n) || n <= 0) return DEFAULT_LIMIT;
  return Math.min(n, MAX_LIMIT);
}

/**
 * AWS Lambda Handler: GET /dashboard/history
 */
exports.handler = async (event) => {
    try {
        const userId = event.requestContext?.authorizer?.uid || event.requestContext?.authorizer?.claims?.sub;
        if (!userId) {
            return {
                statusCode: 401,
                body: JSON.stringify({ error: 'UNAUTHORIZED', message: 'Missing user context' })
            };
        }

        const {
            cursor,          // preferred: opaque base64 cursor (nextCursor from a prior page)
            lastSessionId,   // legacy cursor parts (kept for back-compat)
            lastStartedAt,
            moduleType,
            limit
        } = event.queryStringParameters || {};

        const params = {
            TableName: SESSIONS_TABLE,
            IndexName: 'GSI_UserIdStartedAt',
            KeyConditionExpression: 'userId = :uid',
            ExpressionAttributeValues: {
                ':uid': userId
            },
            ScanIndexForward: false, // Newest first
            Limit: resolveLimit(limit)
        };

        if (moduleType) {
            params.FilterExpression = 'moduleType = :mt';
            params.ExpressionAttributeValues[':mt'] = moduleType;
        }

        // Resolve the continuation key. Both paths validate the shape and BIND
        // the key to the authenticated user so a forged/cross-user cursor can
        // not pivot the query onto another partition, and coerce startedAt to
        // the numeric type the GSI sort key requires (the original string-typed
        // key raised a ValidationException and broke pagination past page 1).
        try {
            if (cursor) {
                params.ExclusiveStartKey = buildStartKeyForUser(decodeCursor(cursor), userId);
            } else if (lastSessionId && lastStartedAt) {
                params.ExclusiveStartKey = buildStartKeyForUser(
                    { userId, sessionId: lastSessionId, startedAt: lastStartedAt },
                    userId
                );
            }
        } catch (e) {
            if (e.code === 'INVALID_CURSOR') {
                return {
                    statusCode: 400,
                    body: JSON.stringify({ error: 'INVALID_CURSOR', message: 'Invalid pagination cursor.' })
                };
            }
            throw e;
        }

        const command = new QueryCommand(params);
        const result = await require('../../lib/deadline').sendBounded(docClient,command);

        // `discarded` (empty/abandoned sessions) is filtered out AFTER the page
        // is read, so a page can legitimately be empty while more pages remain.
        // We therefore always surface the continuation cursor whenever DynamoDB
        // reports one — the client must keep paging until nextCursor is null,
        // not stop on an empty `sessions` array.
        const nextCursor = encodeCursor(result.LastEvaluatedKey);

        return {
            statusCode: 200,
            body: JSON.stringify({
                // Explicit ungraded outcomes retain a history/transcript entry;
                // old discarded sessions keep their existing hidden behavior.
                sessions: (result.Items || []).filter(x => !x.discarded || x.feedbackExpected === false),
                nextCursor,
                // Retained for backward compatibility with older clients; new
                // clients should use the opaque `nextCursor`.
                lastEvaluatedKey: result.LastEvaluatedKey || null
            })
        };

    } catch (error) {
        diagnostics.error('Get Session History Error:', error);
        return {
            statusCode: 500,
            body: JSON.stringify({ error: 'SERVER_ERROR', message: 'Something went wrong. Please try again.' })
        };
    }
};

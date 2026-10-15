/**
 * Opaque pagination cursors for GSI-backed list endpoints.
 *
 * BE-BUG #18 FIX: /session/history handed the raw DynamoDB key back to the
 * client as `{ lastSessionId, lastStartedAt }` and rebuilt `ExclusiveStartKey`
 * with `startedAt: lastStartedAt` — a STRING — against `GSI_UserIdStartedAt`
 * whose sort key is numeric (type N). lib-dynamodb marshals a JS string to `S`,
 * so DynamoDB rejected the key with a ValidationException and pagination was
 * dead past the first page. Exposing the raw key also let a caller hand-craft a
 * key for another partition.
 *
 * The cursor is base64(JSON(LastEvaluatedKey)) — opaque to the client. The
 * caller decodes it, then re-validates and re-binds it to the authenticated
 * user before use (see buildStartKeyForUser), so a tampered or cross-user
 * cursor can never pivot the query onto another user's partition.
 */

/** Encode a DynamoDB LastEvaluatedKey into an opaque cursor string (or null). */
function encodeCursor(lastEvaluatedKey) {
  if (!lastEvaluatedKey) return null;
  return Buffer.from(JSON.stringify(lastEvaluatedKey), 'utf8').toString('base64');
}

/**
 * Decode an opaque cursor back into a plain key object.
 * Throws an Error with `.code = 'INVALID_CURSOR'` on any malformed input.
 */
function decodeCursor(cursor) {
  const fail = () => {
    const err = new Error('Malformed pagination cursor.');
    err.code = 'INVALID_CURSOR';
    return err;
  };

  let parsed;
  try {
    parsed = JSON.parse(Buffer.from(String(cursor), 'base64').toString('utf8'));
  } catch (_e) {
    throw fail();
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw fail();
  }
  return parsed;
}

/**
 * Validate a decoded GSI_UserIdStartedAt key and bind it to `userId`.
 *
 * - `sessionId` must be a non-empty string (base-table PK).
 * - `startedAt` must coerce to a finite number (the numeric GSI sort key).
 * - `userId` is FORCED to the authenticated user; a cursor that carries a
 *   different userId is rejected rather than silently repointed.
 *
 * Throws an Error with `.code = 'INVALID_CURSOR'` if the shape is wrong.
 * @returns {{ userId: string, sessionId: string, startedAt: number }}
 */
function buildStartKeyForUser(decodedKey, userId) {
  const fail = () => {
    const err = new Error('Malformed pagination cursor.');
    err.code = 'INVALID_CURSOR';
    return err;
  };

  if (!decodedKey || typeof decodedKey !== 'object') throw fail();
  if (typeof decodedKey.sessionId !== 'string' || decodedKey.sessionId.length === 0) throw fail();

  // Reject a cursor minted for someone else instead of quietly repointing it.
  if (decodedKey.userId !== undefined && decodedKey.userId !== userId) throw fail();

  const startedAt = Number(decodedKey.startedAt);
  if (!Number.isFinite(startedAt)) throw fail();

  return { userId, sessionId: decodedKey.sessionId, startedAt };
}

module.exports = { encodeCursor, decodeCursor, buildStartKeyForUser };

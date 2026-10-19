const { randomBytes, createHmac } = require('node:crypto');
const { GetCommand, UpdateCommand, TransactWriteCommand } = require('@aws-sdk/lib-dynamodb');
const delivery = require('./emailOtpDelivery');
const ddb = require('./dynamodb');
const deadline = require('./deadline');
const table = () => process.env.EMAIL_OTP_TABLE;
const fault = (code, message, statusCode = 400) => Object.assign(new Error(message), { code, statusCode });
const invalid = () => fault('OTP_INVALID_OR_EXPIRED', 'The code is invalid or expired. Request a new code if needed.');
const limited = () => fault('OTP_RATE_LIMITED', 'Too many attempts. Please wait before trying again.', 429);
const cancelled = e => ['ConditionalCheckFailedException', 'TransactionCanceledException'].includes(e.name);
async function configured() {
  try {
    if (!table()) throw new Error('OTP state table missing');
    return await delivery.configured();
  } catch (_) {
    throw fault('OTP_UNAVAILABLE', 'Email verification is temporarily unavailable. Please try again later or use Google sign-in.', 503);
  }
}

async function identity(event) {
  const header = event.headers?.Authorization || event.headers?.authorization || '';
  const match = /^Bearer ([^\s]+)$/.exec(header);
  if (!match) throw fault('UNAUTHORIZED', 'Please sign in again.', 401);
  const auth = await require('./firebase').getAuth();
  let decoded;
  try { decoded = await deadline.bounded(() => auth.verifyIdToken(match[1], true), { label: 'otpIdentity' }); }
  catch (_) { throw fault('UNAUTHORIZED', 'Please sign in again.', 401); }
  if (!decoded.uid || !Number.isFinite(decoded.auth_time) || Date.now() / 1000 - decoded.auth_time > 900 || decoded.auth_time > Date.now() / 1000 + 60) {
    throw fault('RECENT_LOGIN_REQUIRED', 'Please sign in again before verifying your email.', 401);
  }
  const user = await deadline.bounded(() => auth.getUser(decoded.uid), { label: 'otpUser' });
  if (user.disabled || !user.email || user.email.toLowerCase() !== String(decoded.email || '').toLowerCase()) {
    throw fault('UNAUTHORIZED', 'Please sign in again.', 401);
  }
  await require('./deletionJob').assertNotDeleting(user.uid);
  return { auth, uid: user.uid, email: user.email.toLowerCase(), verified: user.emailVerified === true };
}

async function read(uid) {
  return (await deadline.sendBounded(ddb.docClient, new GetCommand({ TableName: table(), Key: { id: `USER#${uid}` }, ConsistentRead: true }))).Item;
}

const counter = (id, limit, ttl, userId) => ({ Update: {
  TableName: table(), Key: { id }, UpdateExpression: `SET #ttl = :ttl${userId ? ', userId = :uid' : ''} ADD #n :one`,
  ConditionExpression: 'attribute_not_exists(#n) OR #n < :limit', ExpressionAttributeNames: { '#n': 'count', '#ttl': 'ttl' },
  ExpressionAttributeValues: { ':ttl': ttl, ':one': 1, ':limit': limit, ...(userId ? { ':uid': userId } : {}) }
} });
const publicChallenge = row => ({ challengeId: row.challengeId, expiresAt: row.expiresAt * 1000,
  resendAfterSeconds: Math.max(0, row.resendAt - Math.floor(Date.now() / 1000)) });

async function issue(person, ip) {
  if (person.verified) return { verified: true };
  const { key } = await configured();
  const now = Math.floor(Date.now() / 1000), hour = Math.floor(now / 3600);
  const old = await read(person.uid);
  if (old?.resendAt > now) {
    if (old.status === 'SENT' && old.expiresAt > now && old.email === person.email && old.attempts < 5) {
      return { ...publicChallenge(old), alreadySent: true };
    }
    throw limited();
  }
  const sends = old?.hour === hour ? old.sends : 0;
  if (sends >= 5) throw limited();
  const challengeId = randomBytes(16).toString('hex');
  const row = { id: `USER#${person.uid}`, userId: person.uid, email: person.email, challengeId,
    status: 'SENDING', attempts: 0,
    hour, sends: sends + 1, resendAt: now + 60, expiresAt: now + 300, ttl: now + 86400 };
  const ipHash = createHmac('sha256', key).update(String(ip || 'unknown')).digest('hex');
  const daily = Number(process.env.EMAIL_OTP_DAILY_LIMIT || 40);
  if (!Number.isSafeInteger(daily) || daily < 1) throw limited();
  try {
    await ddb.withRetry(() => ddb.fencedSend(new TransactWriteCommand({ TransactItems: [
      // Cognito's built-in sender resets its daily account quota at 09:00 UTC.
      counter(`SEND#DAY#${Math.floor((now - 9 * 3600) / 86400)}`, daily, now + 172800),
      counter(`SEND#IP#${hour}#${ipHash}`, 20, now + 7200),
      { Put: { TableName: table(), Item: row,
        ConditionExpression: old ? 'challengeId = :observed AND resendAt <= :now AND (attribute_not_exists(verificationLease) OR verificationLease <= :now)' : 'attribute_not_exists(id)',
        ...(old ? { ExpressionAttributeValues: { ':observed': old.challengeId, ':now': now } } : {}) } }
    ] }), person.uid));
  } catch (e) { if (cancelled(e)) throw limited(); throw e; }
  try {
    await delivery.send(person.uid, person.email);
    await state(person.uid, challengeId, 'SENDING', 'SENT');
  } catch (error) {
    // A lost provider response is not retried automatically. The next explicit
    // resend rotates the code; an undelivered code must never verify an account.
    await deadline.finalize(() => state(person.uid, challengeId, 'SENDING', 'DELIVERY_FAILED')).catch(() => {});
    if (['LimitExceededException','TooManyRequestsException'].includes(error.name)) {
      throw fault('OTP_RATE_LIMITED','Email delivery is temporarily limited. Please try later or use Google sign-in.',429);
    }
    throw fault('OTP_DELIVERY_FAILED', 'The code could not be sent. Please wait a minute and try again.', 503);
  }
  return publicChallenge(row);
}

async function state(uid, challengeId, from, to) {
  return ddb.fencedSend(new UpdateCommand({ TableName: table(), Key: { id: `USER#${uid}` },
    UpdateExpression: 'SET #s = :next',
    ConditionExpression: 'challengeId = :id AND #s = :previous', ExpressionAttributeNames: { '#s': 'status' },
    ExpressionAttributeValues: { ':id': challengeId, ':previous': from, ':next': to } }), uid);
}

async function verify(person, challengeId, code) {
  if (!/^[a-f0-9]{32}$/.test(challengeId || '') || !/^\d{6}$/.test(code || '') || typeof code !== 'string') throw invalid();
  await configured();
  const row = await read(person.uid), now = Math.floor(Date.now() / 1000);
  if (!row || row.challengeId !== challengeId || row.email !== person.email || row.status !== 'SENT' || row.expiresAt <= now) throw invalid();
  if (row.attempts >= 5) throw limited();
  // Reserve an attempt atomically BEFORE calling the provider. Resends cannot
  // reset the hourly guess budget, and parallel guesses cannot exceed the cap.
  const owner = randomBytes(16).toString('hex');
  try {
    await ddb.withRetry(() => ddb.fencedSend(new TransactWriteCommand({ TransactItems: [
      counter(`VERIFY#${person.uid}#${Math.floor(now / 3600)}`, 20, now + 7200, person.uid),
      { Update: { TableName: table(), Key: { id: row.id }, UpdateExpression: 'SET verificationOwner = :owner, verificationLease = :lease ADD attempts :one',
        ConditionExpression: 'challengeId = :id AND #s = :sent AND attempts < :max AND expiresAt > :now AND email = :email AND (attribute_not_exists(verificationLease) OR verificationLease <= :now)',
        ExpressionAttributeNames: { '#s': 'status' }, ExpressionAttributeValues: {
          ':id': challengeId, ':sent': 'SENT', ':one': 1, ':max': 5, ':now': now, ':email': person.email, ':owner':owner, ':lease':now+20 } } }
    ] }), person.uid));
  } catch (e) { if (cancelled(e)) throw limited(); throw e; }
  try {
    await delivery.confirm(person.uid, code);
  } catch (error) {
    await deadline.finalize(() => ddb.fencedSend(new UpdateCommand({TableName:table(),Key:{id:row.id},
      UpdateExpression:'REMOVE verificationOwner, verificationLease',
      ConditionExpression:'challengeId = :id AND verificationOwner = :owner',
      ExpressionAttributeValues:{':id':challengeId,':owner':owner}}),person.uid)).catch(()=>{});
    if (['CodeMismatchException','ExpiredCodeException','NotAuthorizedException','UserNotFoundException'].includes(error.name)) throw invalid();
    if (['TooManyRequestsException','LimitExceededException'].includes(error.name)) throw limited();
    throw fault('OTP_UNAVAILABLE','Could not verify the code. Please request a new code if needed.',503);
  }
  try {
    await ddb.fencedSend(new UpdateCommand({TableName:table(),Key:{id:row.id},
      UpdateExpression:'SET #s = :consumed REMOVE verificationOwner, verificationLease',
      ConditionExpression:'challengeId = :id AND #s = :sent AND verificationOwner = :owner AND expiresAt > :now',
      ExpressionAttributeNames:{'#s':'status'},ExpressionAttributeValues:{':id':challengeId,':sent':'SENT',':consumed':'CONSUMED',':owner':owner,':now':Math.floor(Date.now()/1000)}}),person.uid);
  } catch (e) { if (cancelled(e)) throw invalid(); throw e; }
  // Bind the verified bit to the exact mailbox that received the code, even if
  // an email-change request races this operation. No client-supplied UID/email.
  await deadline.bounded(() => person.auth.updateUser(person.uid, { email: person.email, emailVerified: true }), { label: 'verifyMailbox' });
  await delivery.remove(person.uid).catch(() => {});
  return { verified: true };
}

module.exports = { configured, identity, issue, verify };

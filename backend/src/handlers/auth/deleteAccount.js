// Persist the deletion fence before touching the identity. The worker owns
// durable cleanup and may safely continue after the Firebase user is gone.
const firebase = require('../../lib/firebase');
const jobs = require('../../lib/deletionJob');
const work = require('../../lib/eventWork');
const deadline = require('../../lib/deadline');
const { deactivateConnectionsByUserId } = require('../../models/wsConnection');
const json = (statusCode, body) => ({ statusCode,
  headers: { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }, body: JSON.stringify(body) });
const unauthorized = () => Object.assign(new Error('Please sign in again.'), { statusCode: 401, code: 'UNAUTHORIZED' });

exports.handler = (event = {}, context) => deadline.withDeadline(context, async () => {
  try {
    const bearer = /^Bearer ([^\s]+)$/.exec(event.headers?.Authorization || event.headers?.authorization || '');
    if (!bearer) throw unauthorized();
    const body = JSON.parse(event.body || '{}');
    if (body.confirmation !== 'DELETE') return json(400, { code: 'CONFIRMATION_REQUIRED', error: 'Confirm account deletion by typing DELETE.' });
    const auth = await firebase.getAuth();
    let decoded, existing;
    try { decoded = await deadline.bounded(() => auth.verifyIdToken(bearer[1], true), { label: 'deleteIdentityProof' }); }
    catch (_) {
      // A response may be lost after identity removal. A still-valid signed
      // token can only retry an ALREADY persisted deletion for its own UID.
      try { decoded = await deadline.bounded(() => auth.verifyIdToken(bearer[1], false), { label: 'deleteRetryProof' }); }
      catch (_) { throw unauthorized(); }
      if (!decoded.uid || !(existing = await jobs.getDeletion(decoded.uid))) throw unauthorized();
    }
    const now = Date.now() / 1000;
    if (!decoded.uid || !Number.isFinite(decoded.auth_time) || decoded.auth_time > now + 60 || now - decoded.auth_time > 300) {
      return json(401, { code: 'RECENT_LOGIN_REQUIRED', error: 'Confirm your password or sign in with Google again before deleting your account.' });
    }
    const uid = decoded.uid; // Never trust a UID/email supplied by the caller.
    const job = existing || await jobs.requestDeletion(uid);
    if (job.status !== 'COMPLETE') {
      try { await work.enqueue({ worker: 'deletion', userId: uid }, Date.now()); }
      catch (error) { require('../../lib/logger').safeConsole.warn('Deletion queue publication deferred to stream', { name: error.name }); }
    }
    let identityDeleted = false;
    try {
      await deadline.bounded(() => firebase.deleteUser(uid), { label: 'deleteFirebaseIdentity' });
      identityDeleted = true;
      await jobs.checkpoint(uid, 'firebaseIdentity', true);
    } catch (error) {
      require('../../lib/logger').safeConsole.warn('Firebase identity deletion requires recovery', { name: error.name });
    }
    try { await deactivateConnectionsByUserId(uid); }
    catch (error) { require('../../lib/logger').safeConsole.warn('Socket revocation requires deletion recovery', { name: error.name }); }
    return json(job.status === 'COMPLETE' && identityDeleted ? 200 : 202, {
      deletionAccepted: true, identityDeleted, status: job.status || 'PENDING', cleanupAfter: job.drainUntil,
      message: identityDeleted ? 'Firebase account removed. Stored-data cleanup continues automatically after outstanding upload links expire.'
        : 'Deletion requested. Identity removal and stored-data cleanup will retry automatically.'
    });
  } catch (error) {
    const status = error instanceof SyntaxError ? 400 : error.statusCode || 503;
    require('../../lib/logger').safeConsole.warn('Account deletion request failed', { name: error.name, code: error.code });
    return json(status, { code: error.code || 'DELETION_UNAVAILABLE', error: error.statusCode ? error.message : 'Could not accept account deletion. Please retry.' });
  }
}, { maxMs: 25000 });

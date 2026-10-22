/**
 * Complete, fail-closed teardown of everything a user owns (finding 2).
 *
 * `deleteAllUserData(uid)` removes every user-owned row and object across all
 * tables and buckets, paginating fully and treating a failed READ as a hard
 * error (never as "nothing to delete"). It returns the list of category
 * failures instead of throwing so the durable deletion worker can retry from
 * checkpoints. Firebase access is removed first; the permanent deletion fence
 * lets cleanup continue safely without a sign-in account.
 * Every operation here is idempotent, so a retry safely re-runs.
 */
const ddb = require('./dynamodb');
const s3 = require('./s3');
const { deactivateConnectionsByUserId } = require('../models/wsConnection');
const { getResumesByUserId } = require('../models/resume');
const { ScanCommand } = require('@aws-sdk/lib-dynamodb');

const SESSIONS_TABLE = process.env.SESSIONS_TABLE || 'qlue-sessions';
const TRANSCRIPTS_TABLE = process.env.TRANSCRIPTS_TABLE || 'qlue-transcripts';
const FEEDBACK_TABLE = process.env.FEEDBACK_TABLE || 'qlue-feedback';
const CONCEPT_STATES_TABLE = process.env.CONCEPT_STATES_TABLE || 'qlue-concept-states';
const NOTIFICATIONS_TABLE = process.env.NOTIFICATIONS_TABLE || 'qlue-notifications';
const USAGE_TABLE = process.env.USAGE_TABLE || 'qlue-usage';
const RESUMES_TABLE = process.env.RESUMES_TABLE || 'qlue-resumes';
const RESUMES_BUCKET = process.env.RESUMES_BUCKET || 'qlue-resumes';
const SCRAPED_CONTENT_BUCKET = process.env.SCRAPED_CONTENT_BUCKET;
const AUDIO_BUCKET = process.env.AUDIO_BUCKET;

// Mirrors models/session.js userLockKey — the per-user active-session lock row
// lives in the sessions table but carries no GSI keys, so it must be deleted
// explicitly by its deterministic primary key.
const userLockKey = (uid) => `LOCK#${uid}`;

/** Query every page of a key/GSI condition, throwing on any read failure. */
async function queryAllItems(table, keyCondition, opts = {}) {
  const items = [];
  let startKey;
  do {
    const res = await ddb.query(table, keyCondition, {
      ...opts,
      ...(startKey && { exclusiveStartKey: startKey })
    });
    if (!res.success) {
      throw new Error(res.error?.message || `query ${table} failed`);
    }
    items.push(...(res.data || []));
    if(opts.onPage) await opts.onPage(res.data||[]);
    startKey = res.lastEvaluatedKey;
  } while (startKey);
  return items;
}

/**
 * Delete keys in chunks of 25 (DynamoDB BatchWrite limit), retrying any
 * UnprocessedItems with backoff. Throws if a write ultimately fails so the
 * category is recorded as failed rather than silently partial.
 */
async function batchDeleteKeys(table, keys) {
  for (let i = 0; i < keys.length; i += 25) {
    let res = await ddb.batchWrite(table, [], keys.slice(i, i + 25));
    if (!res.success) {
      throw new Error(res.error?.message || `batch delete ${table} failed`);
    }
    let unprocessed = res.unprocessedItems?.[table] || [];
    let attempt = 0;
    while (unprocessed.length && attempt < 4) {
      await new Promise((r) => setTimeout(r, 100 * Math.pow(2, attempt)));
      const keysLeft = unprocessed.map((req) => req.DeleteRequest.Key);
      res = await ddb.batchWrite(table, [], keysLeft);
      if (!res.success) {
        throw new Error(res.error?.message || `batch delete ${table} failed`);
      }
      unprocessed = res.unprocessedItems?.[table] || [];
      attempt++;
    }
    if (unprocessed.length) {
      throw new Error(`${table}: ${unprocessed.length} items unprocessed after retries`);
    }
  }
}

/**
 * Hard-purge EVERY version and delete marker under an S3 prefix. On a
 * versioning-enabled bucket a plain delete only writes a delete marker and
 * leaves the prior content recoverable (R-03 resurrection risk), so account
 * teardown must enumerate and remove each version explicitly. deleteObjects
 * throws on any per-object S3 error, so a partial purge fails its category
 * rather than reporting success.
 */
async function purgeVersionedPrefix(bucket, prefix) {
  const objects = await s3.listObjectVersions(bucket, prefix,page=>s3.deleteObjects(bucket,page));
  await s3.deleteObjects(bucket, objects);
}

/**
 * Delete every session the user owns plus each session's children (transcripts
 * and concept states), then the per-user active-session lock row.
 *
 * Concept states are enumerated via GSI_SessionIdConcept and deleted by their
 * real primary key `conceptId` — the base table is keyed on conceptId alone,
 * so the session GSI is the only reliable way to find a session's concept rows.
 *
 * Each session's synthesized audio lives at audio/<sessionId>/<turn>.mp3 in
 * AUDIO_BUCKET with no DynamoDB record of its own, so it is purged (all
 * versions) per session here before the session row is removed.
 */
async function deleteSessionsAndChildren(uid) {
  await queryAllItems(SESSIONS_TABLE, 'userId = :uid', {
    index: 'GSI_UserIdStartedAt',
    values: { ':uid': uid },
    projection: 'sessionId',
    onPage: async sessions => {
  for (const { sessionId } of sessions) {
    const transcripts = await queryAllItems(TRANSCRIPTS_TABLE, 'sessionId = :sid', {
      index: 'GSI_SessionIdTurnIndex',
      values: { ':sid': sessionId },
      projection: 'transcriptId'
    });
    await batchDeleteKeys(TRANSCRIPTS_TABLE, transcripts.map((t) => ({ transcriptId: t.transcriptId })));

    const concepts = await queryAllItems(CONCEPT_STATES_TABLE, 'sessionId = :sid', {
      index: 'GSI_SessionIdConcept',
      values: { ':sid': sessionId },
      projection: 'conceptId'
    });
    await batchDeleteKeys(CONCEPT_STATES_TABLE, concepts.map((c) => ({ conceptId: c.conceptId })));

    // Purge the session's TTS audio (all versions) before dropping the row.
    if (AUDIO_BUCKET) {
      await purgeVersionedPrefix(AUDIO_BUCKET, `audio/${sessionId}/`);
    }
    if(process.env.ANSWER_AUDIO_BUCKET) await purgeVersionedPrefix(process.env.ANSWER_AUDIO_BUCKET, `answers/${sessionId}/`);
    // Drop each parent only after its children are purged, so a deadline retry
    // makes forward progress and can still discover every unfinished child.
    await batchDeleteKeys(SESSIONS_TABLE,[{sessionId}]);
  }
    }
  });

  // The lock row has no GSI attributes, so delete it explicitly. delete() is
  // idempotent — removing an absent key still succeeds.
  const lock = await ddb.delete(SESSIONS_TABLE, { sessionId: userLockKey(uid) });
  if (!lock.success) {
    throw new Error(lock.error?.message || 'session lock delete failed');
  }
}

/** Delete all feedback rows via GSI_UserIdGeneratedAt. */
async function deleteFeedback(uid) {
  const rows = await queryAllItems(FEEDBACK_TABLE, 'userId = :uid', {
    index: 'GSI_UserIdGeneratedAt',
    values: { ':uid': uid },
    projection: 'feedbackId'
  });
  await batchDeleteKeys(FEEDBACK_TABLE, rows.map((r) => ({ feedbackId: r.feedbackId })));
}

/** Delete all notification rows via GSI_UserIdSentAt. */
async function deleteNotifications(uid) {
  const rows = await queryAllItems(NOTIFICATIONS_TABLE, 'userId = :uid', {
    index: 'GSI_UserIdSentAt',
    values: { ':uid': uid },
    projection: 'notificationId'
  });
  await batchDeleteKeys(NOTIFICATIONS_TABLE, rows.map((r) => ({ notificationId: r.notificationId })));
}

/**
 * Delete usage rows (PK userId + SK date). `date` is a DynamoDB reserved word,
 * so it must be projected through an expression-attribute name.
 */
async function deleteUsage(uid) {
  const rows = await queryAllItems(USAGE_TABLE, 'userId = :uid', {
    values: { ':uid': uid },
    projection: '#d',
    names: { '#d': 'date' }
  });
  await batchDeleteKeys(USAGE_TABLE, rows.map((r) => ({ userId: uid, date: r.date })));
}

/**
 * Delete resume objects from S3 first, then their DynamoDB records. Resume
 * objects are written under resumes/<uid>/ (generatePresignedUrl), so a single
 * version-aware prefix purge removes every current and historical version plus
 * any delete markers — not just the current version a plain delete would leave
 * recoverable (R-03). The record read throws on failure (getResumesByUserId)
 * and the purge is idempotent, so a retry re-runs cleanly.
 */
async function deleteResumes(uid) {
  const resumes = await getResumesByUserId(uid);
  await purgeVersionedPrefix(RESUMES_BUCKET, `resumes/${uid}/`);
  await batchDeleteKeys(RESUMES_TABLE, resumes.map((r) => ({ resumeId: r.resumeId })));
}

/**
 * Delete untracked job-description PDF uploads under jd/<uid>/ — these have no
 * DynamoDB record, so they are enumerated straight from the bucket. All versions
 * and delete markers are purged so nothing is recoverable after deletion.
 */
async function deleteJdUploads(uid) {
  if (!SCRAPED_CONTENT_BUCKET) return;
  await purgeVersionedPrefix(SCRAPED_CONTENT_BUCKET, `jd/${uid}/`);
}

async function deleteSupport(uid) {
  const table = process.env.SUPPORT_TABLE || 'qlue-support';
  let key;
  do {
    const page = await require('./deadline').sendBounded(ddb.docClient,new ScanCommand({TableName:table,ExclusiveStartKey:key,
      FilterExpression:'userId = :uid',ExpressionAttributeValues:{':uid':uid},ProjectionExpression:'ticketId'}));
    await batchDeleteKeys(table,(page.Items||[]).map(row=>({ticketId:row.ticketId})));
    key=page.LastEvaluatedKey;
  } while(key);
}

async function deleteOwnedScan(table, uid, primaryKey) {
  let key;
  do {
    const page=await require('./deadline').sendBounded(ddb.docClient,new ScanCommand({TableName:table,ExclusiveStartKey:key,FilterExpression:'userId = :uid',ExpressionAttributeValues:{':uid':uid}}));
    await batchDeleteKeys(table,(page.Items||[]).map(row=>({[primaryKey]:row[primaryKey]})));
    key=page.LastEvaluatedKey;
  }while(key);
}
/**
 * Run every category teardown, collecting per-category failures instead of
 * throwing. Live access is revoked FIRST so no new rows are written mid-wipe.
 * Steps run sequentially to keep failures attributable and bound concurrency.
 */
async function deleteAllUserData(uid, { completed = {}, onCheckpoint = async () => {}, shouldContinue = () => true } = {}) {
  const failures = [];
  const step = async (label, fn) => {
    if (completed[label]) return;
    if (!shouldContinue()) { failures.push(`${label}: invocation deadline; retry from checkpoint`); return; }
    try {
      await fn();
      await onCheckpoint(label, true);
    } catch (e) {
      failures.push(`${label}: ${e.message}`);
    }
  };

  if (process.env.STT_SESSIONS_TABLE) await step('speechRecognition', () => deleteOwnedScan(process.env.STT_SESSIONS_TABLE, uid, 'pk'));
  if (process.env.EMAIL_OTP_TABLE) await step('emailOtp', async () => {
    await require('./emailOtpDelivery').remove(uid);
    const result = await require('./dynamodb').delete(process.env.EMAIL_OTP_TABLE, {id:`USER#${uid}`});
    if (!result.success) throw result.error;
    await deleteOwnedScan(process.env.EMAIL_OTP_TABLE, uid, 'id');
  });
  await step('analysisJobs', () => deleteOwnedScan(process.env.ANALYSIS_JOBS_TABLE||'qlue-analysis-jobs', uid, 'jobId'));
  await step('submissionReceipts', () => deleteOwnedScan(TRANSCRIPTS_TABLE, uid, 'transcriptId'));
  await step('wsConnections', async () => {
    await deactivateConnectionsByUserId(uid);
    await deleteOwnedScan(process.env.WS_CONNECTIONS_TABLE||'qlue-ws-connections',uid,'connectionId');
  });
  await step('sessions', () => deleteSessionsAndChildren(uid));
  await step('feedback', () => deleteFeedback(uid));
  await step('resumes', () => deleteResumes(uid));
  await step('notifications', () => deleteNotifications(uid));
  await step('usage', () => deleteUsage(uid));
  await step('jdUploads', () => deleteJdUploads(uid));
  await step('support', () => deleteSupport(uid));

  return { failures };
}

module.exports = { deleteAllUserData };

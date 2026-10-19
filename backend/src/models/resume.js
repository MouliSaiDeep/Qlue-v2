const { get, put, update, query, delete: remove } = require('../lib/dynamodb');

const RESUMES_TABLE = process.env.RESUMES_TABLE || 'qlue-resumes';

/**
 * Creates a new resume record.
 */
async function createResume(resumeData) {
    const item = {
        ...resumeData,
        status: resumeData.status || 'PENDING',
        uploadedAt: Date.now(),
        isActive: false
    };
    return await put(RESUMES_TABLE, item);
}

async function reissueResumeUpload(existing, upload) {
    const values={':uid':existing.userId,':oldStatus':existing.status,':status':'UPLOADING',
      ':key':upload.s3Key,':attempt':upload.uploadAttemptId,':now':Date.now(),
      ':size':upload.fileSize,':name':upload.fileName,':protocol':2};
    let condition='attribute_exists(resumeId) AND userId = :uid AND #st = :oldStatus';
    if(existing.uploadAttemptId) {condition+=' AND uploadAttemptId = :oldAttempt';values[':oldAttempt']=existing.uploadAttemptId;}
    else condition+=' AND attribute_not_exists(uploadAttemptId)';
    if(existing.s3Key) {condition+=' AND s3Key = :oldKey';values[':oldKey']=existing.s3Key;}
    else condition+=' AND attribute_not_exists(s3Key)';
    return update(RESUMES_TABLE,{resumeId:existing.resumeId},
      'SET #st = :status, s3Key = :key, uploadAttemptId = :attempt, uploadedAt = :now, fileSize = :size, fileName = :name, uploadProtocol = :protocol REMOVE parseWorkerJob, parseAttemptId, parseVersion, s3VersionId, parseLeaseOwner, parseLeaseExpiresAt, failReason',
      values,{'#st':'status'},{condition,userId:existing.userId});
}

/**
 * Retrieves a resume by ID.
 */
async function getResumeById(resumeId) {
    const res = await get(RESUMES_TABLE, { resumeId },{consistentRead:true});
    return res.data || null;
}

/**
 * Lists all resumes for a specific user, newest first.
 *
 * Throws on a query failure instead of returning an empty list. Silently
 * mapping a failed read (e.g. AccessDenied, throttling) to `[]` made callers
 * that must be COMPLETE — account deletion — believe the user owned no resumes
 * and skip cleanup while reporting success (finding 2). Callers that only need
 * a best-effort list can catch.
 */
async function getResumesByUserId(userId) {
    const options = {
        index: 'GSI_UserIdUploadedAt',
        values: { ':uid': userId },
        scanIndexForward: false
    };
    const items=[]; let key;
    do {
      const res = await query(RESUMES_TABLE, 'userId = :uid', {...options, ...(key ? {exclusiveStartKey:key} : {})});
      if (!res.success) throw new Error(`Failed to list resumes for user: ${res.error?.message || 'query failed'}`);
      items.push(...(res.data||[])); key=res.lastEvaluatedKey;
    } while(key);
    return items;
}

/**
 * Updates resume status and parsed data.
 *
 * R-03: the write is CONDITIONAL on the resume row still existing
 * (attribute_exists(resumeId)). An in-flight async worker can finish parsing
 * AFTER the owner started account deletion and the row was purged; a plain
 * update would RE-CREATE the row (DynamoDB upserts), resurrecting data the wipe
 * removed. Binding the commit to an existing row makes a late worker a no-op
 * instead. A ConditionalCheckFailed is therefore benign (nothing to update), so
 * it is reported as a skipped success rather than an error.
 */
async function updateResumeParsingResult(resumeId, status, parsedData = null, failReason = null, userId, attemptId, source) {
    let updateExp = 'SET #st = :status, updatedAt = :ua';
    const values = {
        ':status': status,
        ':ua': new Date().toISOString()
    };
    const names = { '#st': 'status' };
    if(source?.key) {updateExp+=', s3Key = :source, s3VersionId = :sourceVersion';values[':source']=source.key;values[':sourceVersion']=source.versionId;}

    if (parsedData) {
        updateExp += ', parsedData = :pd, parsedAt = :pa';
        values[':pd'] = parsedData;
        values[':pa'] = Date.now();
    }
    if (failReason) {
        updateExp += ', failReason = :fr';
        values[':fr'] = failReason;
    }

    let condition='attribute_exists(resumeId)';
    if(attemptId) {condition+=' AND parseAttemptId = :attempt';values[':attempt']=attemptId;}
    else condition+=' AND attribute_not_exists(parseAttemptId)';
    if(source?.leaseOwner) {
      condition+=' AND parseLeaseOwner = :leaseOwner AND #st = :parsing';
      values[':leaseOwner']=source.leaseOwner;values[':parsing']='PARSING';
    }
    const res = await update(RESUMES_TABLE, { resumeId }, updateExp, values, names, {
        condition, userId
    });
    if (!res.success && res.error?.name === 'ConditionalCheckFailedException') {
        // The resume row is gone (e.g. purged by account deletion) — do not
        // resurrect it. Treat the stale write as a successful no-op.
        return { success: true, skipped: true };
    }
    return res;
}

/**
 * Atomically CLAIM a resume for parsing, keyed to the uploaded object's
 * immutable version (R-02). This is the idempotency guard that makes repeated
 * or concurrent `POST /resume/process` calls start exactly ONE paid job.
 *
 * The conditional write succeeds (status → PARSING, parseVersion → version)
 * only when a new paid job is actually warranted:
 *   - never claimed before (attribute_not_exists(parseVersion)), OR
 *   - a DIFFERENT object version was uploaded to the same key (genuine
 *     re-upload → re-parse the new content), OR
 *   - the previous attempt ended in FAILED (an explicit retry).
 * A repeated request for the SAME version while PENDING/PARSING/PARSED fails the
 * condition → { claimed:false } and NO second Textract/Bedrock job is started.
 *
 * Returns { claimed:true, record } on a fresh claim, { claimed:false } when the
 * object version is already claimed. Throws on any non-conditional failure.
 */
async function claimResumeParse(resumeId, version, userId, workerJob) {
  const attemptId=require('node:crypto').randomUUID();
  const res = await update(
    RESUMES_TABLE,
    { resumeId },
    'SET #st = :parsing, parseVersion = :ver, parseAttemptId = :attempt, parseRecoveryAttempts = :zero, claimedAt = :now, updatedAt = :ua'+(workerJob?', parseWorkerJob = :job':'')+' REMOVE failReason, parseLeaseOwner, parseLeaseExpiresAt',
    {
      ':parsing': 'PARSING',
      ':ver': version,
      ':now': Date.now(),
      ':ua': new Date().toISOString(),
      ':failed': 'FAILED'
      ,':attempt':attemptId
      ,':zero':0
      ,...(workerJob?{':job':{...workerJob,parseAttemptId:attemptId}}:{})
      ,...(workerJob?{':key':workerJob.s3Key,':uid':userId}:{})
    },
    { '#st': 'status' },
    { condition: 'attribute_exists(resumeId) AND #st <> :parsing AND (attribute_not_exists(parseVersion) OR parseVersion <> :ver OR #st = :failed)' +
      (workerJob ? ' AND s3Key = :key AND userId = :uid' : ''),userId }
  );
  if (res.success) return { claimed: true, record: res.data, attemptId };
  if (res.error?.name === 'ConditionalCheckFailedException') return { claimed: false };
  throw res.error || new Error('Failed to claim resume for parsing');
}

// Lambda async delivery is at least once. Only one invocation may perform paid
// work for this attempt; an expired lease can be reclaimed after a crash.
async function claimResumeExecution(resumeId, userId, s3Key, attemptId) {
  const owner = require('node:crypto').randomUUID();
  const res = await update(RESUMES_TABLE, { resumeId },
    'SET parseLeaseOwner = :owner, parseLeaseExpiresAt = :expiry',
    { ':owner': owner, ':expiry': Date.now() + 130000, ':now': Date.now(),
      ':uid': userId, ':key': s3Key, ':parsing': 'PARSING', ...(attemptId ? { ':attempt': attemptId } : {}) },
    { '#st': 'status' },
    { condition: 'attribute_exists(resumeId) AND userId = :uid AND s3Key = :key AND #st = :parsing AND ' +
      (attemptId ? 'parseAttemptId = :attempt' : 'attribute_not_exists(parseAttemptId)') +
      ' AND (attribute_not_exists(parseLeaseExpiresAt) OR parseLeaseExpiresAt <= :now)', userId });
  if (res.success) return { claimed: true, owner, record: res.data };
  if (res.error?.name === 'ConditionalCheckFailedException') return { claimed: false };
  throw res.error || new Error('Failed to claim resume execution');
}

/**
 * Deletes a resume record.
 */
async function deleteResumeRecord(resumeId) {
    return await remove(RESUMES_TABLE, { resumeId });
}

module.exports = {
    createResume,
    reissueResumeUpload,
    getResumeById,
    getResumesByUserId,
    updateResumeParsingResult,
    claimResumeParse,
    claimResumeExecution,
    deleteResumeRecord
};

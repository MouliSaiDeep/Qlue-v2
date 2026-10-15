const diagnostics=require('./logger').safeConsole;
const {sendBounded,remaining,bounded,streamBounded}=require('./deadline');
/**
 * Application wrappers for AWS S3 operations using SDK v3.
 */
const {
  S3Client,
  GetObjectCommand,
  PutObjectCommand,
  CopyObjectCommand,
  DeleteObjectCommand,
  DeleteObjectsCommand,
  HeadObjectCommand,
  ListObjectsV2Command,
  ListObjectVersionsCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { createPresignedPost } = require('@aws-sdk/s3-presigned-post');

async function generateUploadPost(bucket, key, size) {
  return bounded(()=>createPresignedPost(s3Client, { Bucket: bucket, Key: key, Expires: 60,
    Fields: { 'Content-Type': 'application/pdf', tagging:'<Tagging><TagSet><Tag><Key>qlue-upload</Key><Value>staging</Value></Tag></TagSet></Tagging>' },
    Conditions: [['content-length-range', size, size], ['eq', '$Content-Type', 'application/pdf']] }),{label:'uploadSigning'});
}

async function promoteUpload(bucket,key,versionId,destination,userId) {
  await require('./deletionJob').assertNotDeleting(userId);
  const result=await sendBounded(s3Client,new CopyObjectCommand({Bucket:bucket,Key:destination,
    CopySource:`${bucket}/${key.split('/').map(encodeURIComponent).join('/')}?versionId=${encodeURIComponent(versionId)}`,
    TaggingDirective:'REPLACE',Tagging:'qlue-upload=active'}));
  if(!result.VersionId) throw new Error('Promoted resume has no immutable version');
  return {key:destination,versionId:result.VersionId};
}

const s3Client = new S3Client({ 
  region: process.env.AWS_REGION || 'us-east-1',
  // Stable clients upload bytes after signing; the signer has no PDF body.
  // Do not sign the SDK's optional checksum for an empty request body.
  requestChecksumCalculation: 'WHEN_REQUIRED'
});

/**
 * Generates a presigned URL acting as a delegate for upload endpoints.
 */
async function generatePresignedUrl(bucket, key, operation = 'putObject', expiresIn = 3600, contentType = null) {
  let command;
  if (operation === 'putObject') {
    const params = {
      Bucket: bucket,
      Key: key,
    };
    if (contentType) {
      params.ContentType = contentType;
    }
    command = new PutObjectCommand(params);
  } else {
    command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
  }

  try {
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn
    });
    return signedUrl;
  } catch (error) {
    diagnostics.error('S3 presigned URL generation failed', error);
    throw error;
  }
}

/**
 * Fetches an object buffer. An optional versionId pins the read to one exact
 * object version so a validate-then-process pipeline can't be fed different
 * bytes by an overwrite between steps (R-04 TOCTOU). On a non-versioned bucket
 * versionId is null/absent and the latest object is returned, unchanged.
 */
async function getObject(bucket, key, versionId = null, { maxBytes = 10 * 1024 * 1024 } = {}) {
  try {
    const command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(versionId && { VersionId: versionId })
    });
    const response = await sendBounded(s3Client, command);
    
    // AWS SDK v3 body is a stream in node
    const stream = response.Body;
    const chunks = [];
    let bytes = 0;
    for await (const chunk of streamBounded(stream,{maxBytes,label:'s3Download'})) {
      if(remaining()<=0) {stream.destroy?.();throw new Error('Download deadline exhausted');}
      bytes += chunk.length;
      if (bytes > maxBytes) { stream.destroy?.(); throw new Error('S3 object exceeds download byte limit'); }
      chunks.push(chunk);
    }
    
    return Buffer.concat(chunks);
  } catch (error) {
    if (error.name === 'NoSuchKey') {
      return null;
    }
    throw error;
  }
}

/**
 * Puts an object.
 */
async function putObject(bucket, key, body, contentType = 'application/octet-stream') {
  try {
    const command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: body,
      ContentType: contentType
    });
    
    await sendBounded(s3Client, command);
    return true;
  } catch (error) {
    diagnostics.error('S3 object write failed', error);
    throw error;
  }
}

/**
 * Deletes an object.
 */
async function deleteObject(bucket, key) {
  try {
    const command = new DeleteObjectCommand({ Bucket: bucket, Key: key });
    await sendBounded(s3Client, command);
    return true;
  } catch (error) {
    diagnostics.error('S3 object deletion failed', error);
    throw error;
  }
}

/**
 * Verifies if an object exists.
 */
async function objectExists(bucket, key) {
  try {
    const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
    await sendBounded(s3Client, command);
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

/**
 * Fetches an object's metadata without downloading its body. Returns null when
 * the object does not exist. Used to check the REAL uploaded size before paying
 * for OCR (a presigned PUT without a content-length-range lets a client upload
 * far more than the fileSize it declared at presign time — finding 4). An
 * optional versionId pins the metadata read to one exact object version (R-04).
 */
async function headObject(bucket, key, versionId = null) {
  try {
    const res = await sendBounded(s3Client, new HeadObjectCommand({
      Bucket: bucket,
      Key: key,
      ...(versionId && { VersionId: versionId })
    }));
    return {
      contentLength: res.ContentLength,
      contentType: res.ContentType,
      metadata: res.Metadata || {},
      // Immutable per-content identifiers used to make paid processing idempotent
      // (R-02): a repeated request for the same object version must not start a
      // second paid job. VersionId is present on versioned buckets; ETag is
      // always present and changes whenever the object content changes.
      etag: res.ETag ? res.ETag.replace(/"/g, '') : undefined,
      versionId: res.VersionId
    };
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return null;
    }
    throw error;
  }
}

/**
 * Lists every object key under a prefix, paging through all results. Used to
 * purge untracked per-user artifacts (e.g. jd/<uid>/...) during account
 * deletion, which — unlike resumes — have no DynamoDB record to enumerate.
 */
async function listObjectKeys(bucket, prefix) {
  const keys = [];
  let continuationToken;
  do {
    const res = await sendBounded(s3Client, new ListObjectsV2Command({
      Bucket: bucket,
      Prefix: prefix,
      ContinuationToken: continuationToken
    }));
    for (const obj of res.Contents || []) {
      if (obj.Key) keys.push(obj.Key);
    }
    continuationToken = res.IsTruncated ? res.NextContinuationToken : undefined;
  } while (continuationToken);
  return keys;
}

/**
 * Lists EVERY version and delete marker under a prefix, paging through all
 * results. On a versioning-enabled bucket, deleteObject only writes a delete
 * marker — the prior content versions survive and can be restored (R-03
 * resurrection risk). Account deletion must enumerate these so it can hard-purge
 * them. Returns a flat [{ Key, VersionId }] list combining both object versions
 * and delete markers.
 */
async function listObjectVersions(bucket, prefix, onPage) {
  const objects = [];
  let keyMarker;
  let versionIdMarker;
  do {
    const page=[];
    const res = await sendBounded(s3Client, new ListObjectVersionsCommand({
      Bucket: bucket,
      Prefix: prefix,
      KeyMarker: keyMarker,
      VersionIdMarker: versionIdMarker
    }));
    for (const v of res.Versions || []) {
      if (v.Key) page.push({ Key: v.Key, VersionId: v.VersionId });
    }
    for (const m of res.DeleteMarkers || []) {
      if (m.Key) page.push({ Key: m.Key, VersionId: m.VersionId });
    }
    if(onPage) await onPage(page);else objects.push(...page);
    if (res.IsTruncated) {
      keyMarker = res.NextKeyMarker;
      versionIdMarker = res.NextVersionIdMarker;
    } else {
      keyMarker = undefined;
      versionIdMarker = undefined;
    }
  } while (keyMarker || versionIdMarker);
  return objects;
}

/**
 * Permanently deletes the given [{ Key, VersionId }] objects in batches of up to
 * 1000 (the S3 limit). Specifying VersionId removes that exact version rather
 * than writing a new delete marker, so this truly purges content. Fail-closed:
 * S3 reports per-object failures in a 200 response, so a non-empty Errors array
 * throws — a partial purge must be surfaced to the caller as a failure (R-03),
 * never silently swallowed.
 */
async function deleteObjects(bucket, objects) {
  if (!objects || objects.length === 0) return 0;
  let deleted = 0;
  for (let i = 0; i < objects.length; i += 1000) {
    const chunk = objects.slice(i, i + 1000);
    const res = await sendBounded(s3Client, new DeleteObjectsCommand({
      Bucket: bucket,
      Delete: {
        Objects: chunk.map(({ Key, VersionId }) => (VersionId ? { Key, VersionId } : { Key })),
        Quiet: true
      }
    }));
    if (res.Errors && res.Errors.length > 0) {
      const first = res.Errors[0];
      throw new Error(`S3 batch delete failed for ${res.Errors.length} object(s) in ${bucket} (e.g. ${first.Key}: ${first.Code})`);
    }
    deleted += chunk.length;
  }
  return deleted;
}

module.exports = {
  promoteUpload,
  generatePresignedUrl,
  generateUploadPost,
  getObject,
  putObject,
  deleteObject,
  objectExists,
  headObject,
  listObjectKeys,
  listObjectVersions,
  deleteObjects
};

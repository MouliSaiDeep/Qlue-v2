/**
 * Application wrappers for AWS S3 operations using SDK v3.
 */
const { 
  S3Client, 
  GetObjectCommand,
  PutObjectCommand,
  DeleteObjectCommand,
  HeadObjectCommand
} = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');

const s3Client = new S3Client({ 
  region: process.env.AWS_REGION || 'us-east-1'
});

/**
 * Generates a presigned URL acting as a delegate for upload endpoints.
 */
async function generatePresignedUrl(bucket, key, operation = 'putObject', expiresIn = 3600) {
  let command;
  if (operation === 'putObject') {
    command = new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      // Do NOT include ContentType here — omitting it means ContentType
      // is not in the signed headers, so the client can PUT with any (or no) content type.
    });
  } else {
    command = new GetObjectCommand({
      Bucket: bucket,
      Key: key,
    });
  }

  try {
    const signedUrl = await getSignedUrl(s3Client, command, {
      expiresIn,
      unhoistableHeaders: new Set(['x-amz-checksum-crc32']),
    });
    return signedUrl;
  } catch (error) {
    console.error(`Presigned URL generation failed for ${bucket}/${key}`, error);
    throw error;
  }
}

/**
 * Fetches an object buffer.
 */
async function getObject(bucket, key) {
  try {
    const command = new GetObjectCommand({ Bucket: bucket, Key: key });
    const response = await s3Client.send(command);
    
    // AWS SDK v3 body is a stream in node
    const stream = response.Body;
    const chunks = [];
    for await (const chunk of stream) {
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
    
    await s3Client.send(command);
    return true;
  } catch (error) {
    console.error(`Put string fail on ${bucket}/${key}`, error);
    throw error;
  }
}

/**
 * Deletes an object.
 */
async function deleteObject(bucket, key) {
  try {
    const command = new DeleteObjectCommand({ Bucket: bucket, Key: key });
    await s3Client.send(command);
    return true;
  } catch (error) {
    console.error(`Deletion failed for ${bucket}/${key}`, error);
    throw error;
  }
}

/**
 * Verifies if an object exists.
 */
async function objectExists(bucket, key) {
  try {
    const command = new HeadObjectCommand({ Bucket: bucket, Key: key });
    await s3Client.send(command);
    return true;
  } catch (error) {
    if (error.name === 'NotFound' || error.$metadata?.httpStatusCode === 404) {
      return false;
    }
    throw error;
  }
}

module.exports = {
  generatePresignedUrl,
  getObject,
  putObject,
  deleteObject,
  objectExists
};

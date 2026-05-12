const { generatePresignedUrl, getObject, putObject, deleteObject, objectExists } = require('../../../src/lib/s3');
const { S3Client, GetObjectCommand, PutObjectCommand, DeleteObjectCommand, HeadObjectCommand } = require('@aws-sdk/client-s3');
const { getSignedUrl } = require('@aws-sdk/s3-request-presigner');
const { mockClient } = require('aws-sdk-client-mock');

const s3Mock = mockClient(S3Client);
jest.mock('@aws-sdk/s3-request-presigner');

describe('s3 lib', () => {
    const bucket = 'test-bucket';
    const key = 'test-key';

    beforeEach(() => {
        s3Mock.reset();
        jest.clearAllMocks();
    });

    it('generatePresignedUrl should return a signed URL', async () => {
        getSignedUrl.mockResolvedValue('https://signed.url');
        const url = await generatePresignedUrl(bucket, key);
        expect(url).toBe('https://signed.url');
        expect(getSignedUrl).toHaveBeenCalled();
    });

    it('getObject should return a buffer', async () => {
        const mockStream = {
            async *[Symbol.asyncIterator]() {
                yield Buffer.from('hello');
                yield Buffer.from(' world');
            }
        };

        s3Mock.on(GetObjectCommand).resolves({ Body: mockStream });
        const result = await getObject(bucket, key);
        expect(result.toString()).toBe('hello world');
    });

    it('getObject should return null if key not found', async () => {
        const error = new Error('No such key');
        error.name = 'NoSuchKey';
        s3Mock.on(GetObjectCommand).rejects(error);
        
        const result = await getObject(bucket, key);
        expect(result).toBeNull();
    });

    it('putObject should return true on success', async () => {
        s3Mock.on(PutObjectCommand).resolves({});
        const result = await putObject(bucket, key, 'content');
        expect(result).toBe(true);
    });

    it('deleteObject should return true on success', async () => {
        s3Mock.on(DeleteObjectCommand).resolves({});
        const result = await deleteObject(bucket, key);
        expect(result).toBe(true);
    });

    it('objectExists should return true if found', async () => {
        s3Mock.on(HeadObjectCommand).resolves({});
        const result = await objectExists(bucket, key);
        expect(result).toBe(true);
    });

    it('objectExists should return false if not found', async () => {
        const error = new Error('Not found');
        error.name = 'NotFound';
        s3Mock.on(HeadObjectCommand).rejects(error);
        
        const result = await objectExists(bucket, key);
        expect(result).toBe(false);
    });
});

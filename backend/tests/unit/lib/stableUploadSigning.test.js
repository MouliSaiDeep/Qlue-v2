// The restored client sends a PDF by PUT without calculating checksum headers.
// Exercise the real SDK signer with synthetic credentials, without network I/O.
jest.mock('@aws-sdk/client-s3',()=>{
 const sdk=jest.requireActual('@aws-sdk/client-s3');
 return {...sdk,S3Client:class extends sdk.S3Client {
  constructor(options){super({...options,credentials:{accessKeyId:'synthetic',secretAccessKey:'synthetic'}});}
 }};
});
test('stable PUT signing does not bind a nonempty PDF to an empty-body checksum',async()=>{
 const {generatePresignedUrl}=require('../../../src/lib/s3');
 const url=new URL(await generatePresignedUrl('synthetic-bucket','synthetic.pdf','putObject',900,'application/pdf'));
 expect(url.searchParams.has('x-amz-checksum-crc32')).toBe(false);
 expect(url.searchParams.has('x-amz-sdk-checksum-algorithm')).toBe(false);
 expect(url.searchParams.get('X-Amz-Expires')).toBe('900');
 expect(url.pathname).toBe('/synthetic.pdf');
});

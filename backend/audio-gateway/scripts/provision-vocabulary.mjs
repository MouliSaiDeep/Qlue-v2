// Offline provisioning, never called during an answer. --apply is explicit.
import fs from 'node:fs/promises';
import { S3Client,PutObjectCommand } from '@aws-sdk/client-s3';
import { TranscribeClient,CreateVocabularyCommand,UpdateVocabularyCommand,GetVocabularyCommand } from '@aws-sdk/client-transcribe';
const args=process.argv.slice(2),get=n=>args[args.indexOf(n)+1];
if(!args.includes('--apply')||!args.includes('--bucket')||!args.includes('--data-role-arn'))throw Error('Use --apply --bucket reviewed-bucket --data-role-arn scoped-transcribe-S3-role');
const file=new URL('../vocabulary/technical-en-IN-v1.tsv',import.meta.url),body=await fs.readFile(file,'utf8');
const rows=body.trimEnd().split(/\r?\n/);
if(rows.shift()!=='Phrase\tSoundsLike\tIPA\tDisplayAs'||rows.length>50||rows.some(r=>r.split('\t').length!==4))throw Error('INVALID_PUBLIC_VOCABULARY');
const name='qlue-public-technical-en-IN-v1',bucket=get('--bucket'),key='qlue-public-vocabulary/technical-en-IN-v1.tsv';
const s3=new S3Client({region:'us-east-1'}),client=new TranscribeClient({region:'us-east-1',maxAttempts:1});
try{
  await s3.send(new PutObjectCommand({Bucket:bucket,Key:key,Body:body,ContentType:'text/tab-separated-values',ServerSideEncryption:'AES256'}));
  const command=args.includes('--update')?UpdateVocabularyCommand:CreateVocabularyCommand;
  await client.send(new command({VocabularyName:name,LanguageCode:'en-IN',VocabularyFileUri:`s3://${bucket}/${key}`,DataAccessRoleArn:get('--data-role-arn')}));
  const end=Date.now()+120000;let ready=false;
  do{
    const status=await client.send(new GetVocabularyCommand({VocabularyName:name}));
    if(status.VocabularyState==='FAILED')throw Error('VOCABULARY_PROVISIONING_FAILED: '+status.FailureReason);
    if(status.VocabularyState==='READY'){ready=true;break;}
    await new Promise(r=>setTimeout(r,2000));
  }while(Date.now()<end);
  if(!ready)throw Error('VOCABULARY_READY_TIMEOUT');
  console.info(JSON.stringify({name,language:'en-IN',region:'us-east-1',state:'READY',soundsLikeAndIpaUsed:false}));
}finally{s3.destroy();client.destroy();}

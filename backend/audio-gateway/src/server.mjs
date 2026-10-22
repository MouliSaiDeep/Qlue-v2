import { DynamoDBClient } from '@aws-sdk/client-dynamodb';
import { DynamoDBDocumentClient } from '@aws-sdk/lib-dynamodb';
import { TranscribeStreamingClient } from '@aws-sdk/client-transcribe-streaming';
import { TranscribeClient } from '@aws-sdk/client-transcribe';
import { Store } from './store.mjs';
import { Vocabularies } from './vocabulary.mjs';
import { createAudioServer } from './http-server.mjs';
import { streamMetric } from './telemetry.mjs';
if(process.env.AWS_REGION!=='us-east-1')throw Error('REGION_MUST_BE_US_EAST_1');
const enabled=process.env.AWS_STT_ENABLED==='true';
const store=new Store(DynamoDBDocumentClient.from(new DynamoDBClient({region:'us-east-1',maxAttempts:2,requestHandler:{connectionTimeout:3000,requestTimeout:5000}})),{
  table:process.env.STT_SESSIONS_TABLE,sessions:process.env.SESSIONS_TABLE,deletions:process.env.DELETION_JOBS_TABLE,
  slots:Number(process.env.GLOBAL_STREAM_SLOTS||4),dailyLimit:Number(process.env.DAILY_STREAM_LIMIT||160)});
const transcribe=new TranscribeStreamingClient({region:'us-east-1',maxAttempts:1}); // No implicit replay.
const vocabularies=new Vocabularies(new TranscribeClient({region:'us-east-1',maxAttempts:1}),JSON.parse(process.env.VOCABULARY_MANIFEST||'{}'));
const app=createAudioServer({store,transcribe,vocabularies,enabled,
  ingress:process.env.GATEWAY_INGRESS,maxConnections:process.env.MAX_CONNECTIONS_PER_TASK??8,
  hosting:process.env.AUDIO_HOSTING||'ecs',onMetric:m=>console.info(JSON.stringify(streamMetric(m)))});
app.server.listen(Number(process.env.PORT||8080),'0.0.0.0');
let stopping=false;
async function shutdown(){if(stopping)return;stopping=true;await app.shutdown();transcribe.destroy();process.exit(0);}
process.on('SIGTERM',shutdown);process.on('SIGINT',shutdown);

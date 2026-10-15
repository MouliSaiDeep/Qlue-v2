const {generatePresignedUrl}=require('./s3');
const {bounded,absolute}=require('./deadline');

// Called only with a strongly read, ownership-checked canonical session.
// No client-provided bucket/key/URL and no synthesis or new interview turn.
async function refreshQuestionAudio(session, turnId) {
  const payload=session.lastTurnPayload;
  if(session.currentState!=='USER_RESPONDING' || !payload || payload.expectsAnswer===false || payload.turnId!==turnId) return null;
  const key=payload.audioKey;
  if(typeof key!=='string' || !key.startsWith(`audio/${session.sessionId}/`) || !/^audio\/[^/]+\/[\w-]+\.mp3$/.test(key) || !process.env.AUDIO_BUCKET) return null;
  await require('./deletionJob').assertNotDeleting(session.userId);
  return bounded(()=>generatePresignedUrl(process.env.AUDIO_BUCKET,key,'getObject',300),{label:'questionAudioRefresh',deadlineAt:absolute(3000)});
}
module.exports={refreshQuestionAudio};

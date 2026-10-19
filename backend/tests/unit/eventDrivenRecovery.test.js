const {mockClient} = require('aws-sdk-client-mock');
const {SQSClient, SendMessageCommand} = require('@aws-sdk/client-sqs');
const {DynamoDBDocumentClient, GetCommand, UpdateCommand, DeleteCommand, TransactWriteCommand, ScanCommand, QueryCommand} = require('@aws-sdk/lib-dynamodb');
const {LambdaClient, InvokeCommand} = require('@aws-sdk/client-lambda');
const {marshall} = require('@aws-sdk/util-dynamodb');
const work = require('../../src/lib/eventWork');
const sqs = mockClient(SQSClient), db = mockClient(DynamoDBDocumentClient), lambda = mockClient(LambdaClient);

jest.mock('../../src/lib/deletionJob', () => ({
  TABLE:'deletions', assertNotDeleting:jest.fn(),getDeletion:jest.fn(),setStatus:jest.fn(),checkpoint:jest.fn(),
  deletionFence:userId=>({ConditionCheck:{TableName:'deletions',Key:{userId},ConditionExpression:'attribute_not_exists(userId)'}})
}));
jest.mock('../../src/lib/accountDeletion', () => ({deleteAllUserData:jest.fn()}));
jest.mock('../../src/lib/firebase', () => ({deleteUser:jest.fn()}));
jest.mock('../../src/models/wsConnection', () => ({deactivateConnectionsByUserId:jest.fn()}));
jest.mock('../../src/lib/analysisJobs', () => ({get:jest.fn(),run:jest.fn(),recover:jest.fn()}));
jest.mock('../../src/models/session', () => ({
  ...jest.requireActual('../../src/models/session'),getSession:jest.fn(),updateSessionState:jest.fn()
}));
jest.mock('../../src/lib/feedbackDispatch', () => ({
  ...jest.requireActual('../../src/lib/feedbackDispatch'),publishFeedbackJob:jest.fn()
}));
jest.mock('../../src/lib/feedbackAttempt', () => ({currentAttempt:jest.fn()}));
jest.mock('../../src/handlers/feedback/sendFeedbackNotification', () => ({handler:jest.fn()}));

const deletion = require('../../src/lib/deletionJob');
const analysis = require('../../src/lib/analysisJobs');
const sessions = require('../../src/models/session');
const dispatch = require('../../src/lib/feedbackDispatch');
const notification = require('../../src/handlers/feedback/sendFeedbackNotification');
const {deleteAllUserData} = require('../../src/lib/accountDeletion');
const handlers = {
  analysis:require('../../src/handlers/jd/analysisWorker').handler,
  deletion:require('../../src/handlers/auth/deletionWorker').handler,
  dispatch:require('../../src/handlers/feedback/dispatchFeedbackJobs').handler,
  feedback:require('../../src/handlers/feedback/recoverFeedback').handler,
  resume:require('../../src/handlers/resume/recoverResumes').handler,
  turn:require('../../src/handlers/interview/recoverTurns').handler
};
const stream = (item, old, sequence='1') => ({eventSource:'aws:dynamodb',eventName:old?'MODIFY':'INSERT',
  dynamodb:{SequenceNumber:sequence,NewImage:marshall(item,{removeUndefinedValues:true}),
    ...(old?{OldImage:marshall(old,{removeUndefinedValues:true})}:{})}});
const message = (task,id='message-1') => ({eventSource:'aws:sqs',messageId:id,
  body:JSON.stringify({version:1,dueAt:Date.now()-1,...task})});
const queued = () => sqs.commandCalls(SendMessageCommand).map(call=>({
  queue:call.args[0].input.QueueUrl,delay:call.args[0].input.DelaySeconds,body:JSON.parse(call.args[0].input.MessageBody)
}));
const invoke = (handler,...Records) => handler({Records});
const writes = () => db.commandCalls(TransactWriteCommand).flatMap(call=>
  call.args[0].input.TransactItems.filter(item=>item.Update).map(item=>item.Update));

beforeEach(() => {
  jest.clearAllMocks();sqs.reset();db.reset();lambda.reset();
  sqs.on(SendMessageCommand).resolves({});db.on(UpdateCommand).resolves({});
  db.on(TransactWriteCommand).resolves({});lambda.on(InvokeCommand).resolves({});
  process.env.RECOVERY_QUEUE_URL='recovery';process.env.FEEDBACK_RECOVERY_QUEUE_URL='feedback-recovery';
  process.env.TURN_RECOVERY_QUEUE_URL='turn-recovery';process.env.ASYNC_QUEUE_URL='primary-interview';
  process.env.RESUME_WORKER_LAMBDA='resume-worker';
  deletion.assertNotDeleting.mockResolvedValue(undefined);
  require('../../src/lib/feedbackAttempt').currentAttempt.mockResolvedValue({sessionId:'s'});
});

test('deletion removes Firebase immediately, then retains its 20-minute storage deadline across the SQS limit',async()=>{
  const dueAt=Date.now()+20*60000;
  await invoke(handlers.deletion,stream({userId:'u',status:'PENDING',drainUntil:dueAt}));
  expect(queued()[0]).toMatchObject({delay:0,body:{userId:'u'}});
  expect(deletion.getDeletion).not.toHaveBeenCalled();
  deletion.getDeletion.mockResolvedValue({userId:'u',status:'PENDING',drainUntil:dueAt});
  await invoke(handlers.deletion,message(queued()[0].body));
  expect(require('../../src/lib/firebase').deleteUser).toHaveBeenCalledWith('u');
  expect(deletion.checkpoint).toHaveBeenCalledWith('u','firebaseIdentity',true);
  expect(queued()[1].delay).toBe(900);
  expect(queued()[1].body.dueAt).toBe(dueAt);
  expect(deleteAllUserData).not.toHaveBeenCalled();
  await invoke(handlers.deletion,message(queued()[1].body));
  expect(queued()[2].body.dueAt).toBe(dueAt);
});

test('analysis runs only its queued key, arms an expired-lease check, and never restarts FAILED jobs',async()=>{
  const lease=Date.now()+130000;
  await invoke(handlers.analysis,stream({jobId:'j',status:'RUNNING',leaseExpiresAt:lease}));
  expect(queued()[0]).toMatchObject({body:{jobId:'j',dueAt:lease+1}});
  expect(queued()[0].delay).toBeGreaterThanOrEqual(130);
  analysis.get.mockResolvedValue({jobId:'j',status:'RUNNING',leaseExpiresAt:Date.now()-10});
  await invoke(handlers.analysis,message({jobId:'j'}));
  expect(analysis.run).toHaveBeenCalledWith('j');
  analysis.get.mockResolvedValue({jobId:'j',status:'FAILED'});
  await invoke(handlers.analysis,message({jobId:'j'}));
  expect(analysis.run).toHaveBeenCalledTimes(1);
  expect(analysis.recover).not.toHaveBeenCalled();
});

test('unchanged state, terminal records, deletions, and cursor rows do not create work',async()=>{
  const job={jobId:'j',status:'RUNNING',leaseExpiresAt:Date.now()+10000};
  await invoke(handlers.analysis,stream(job,{...job,attemptCount:0}));
  await invoke(handlers.analysis,stream({jobId:'failed',status:'FAILED'}));
  await invoke(handlers.resume,stream({resumeId:'r',status:'FAILED'}));
  await invoke(handlers.dispatch,stream({sessionId:'RECOVERY#turns',recoveryCursor:true}));
  await invoke(handlers.analysis,{eventSource:'aws:dynamodb',eventName:'REMOVE',dynamodb:{SequenceNumber:'2'}});
  expect(queued()).toHaveLength(0);
});

test('one session stream arms outbox, feedback-timeout, and turn watchdogs against the correct queues',async()=>{
  const now=Date.now();
  await invoke(handlers.dispatch,stream({sessionId:'s',userId:'u',feedbackAttemptId:'a',
    currentState:'GENERATING_FEEDBACK',feedbackJob:{status:'PENDING'},feedbackDispatchPending:'PENDING',
    feedbackJobUpdatedAt:now,feedbackStatus:'PENDING',feedbackAttemptStartedAt:now}));
  expect(queued()).toEqual(expect.arrayContaining([
    expect.objectContaining({queue:'recovery',body:expect.objectContaining({sessionId:'s',attemptId:'a',dueAt:now+60001})}),
    expect.objectContaining({queue:'feedback-recovery',body:expect.objectContaining({kind:'feedbackTimeout',dueAt:now+720001})})
  ]));
  await invoke(handlers.dispatch,stream({sessionId:'s2',userId:'u',currentState:'LOADING_CONTEXT',jobId:'turn-1',leaseExpiresAt:now+75000}));
  expect(queued().at(-1)).toMatchObject({queue:'turn-recovery',body:{sessionId:'s2',jobId:'turn-1',dueAt:now+75000}});
});

test('outbox recovery skips stale attempts, publishes current pending work, and retains transient failure state',async()=>{
  const session={sessionId:'s',userId:'u',feedbackAttemptId:'a',currentState:'GENERATING_FEEDBACK',
    feedbackJobUpdatedAt:Date.now()-70000,feedbackJob:{status:'PENDING',attempts:0}};
  sessions.getSession.mockResolvedValue(session);
  dispatch.publishFeedbackJob.mockResolvedValue({published:true});
  await invoke(handlers.dispatch,message({sessionId:'s',attemptId:'old'}));
  expect(dispatch.publishFeedbackJob).not.toHaveBeenCalled();
  await invoke(handlers.dispatch,message({sessionId:'s',attemptId:'a'}));
  expect(dispatch.publishFeedbackJob).toHaveBeenCalledTimes(1);
  expect(sessions.updateSessionState).toHaveBeenCalledWith('s','TERMINATED','GENERATING_FEEDBACK',expect.objectContaining({expectedFeedbackAttemptId:'a'}));
  dispatch.publishFeedbackJob.mockRejectedValue(new Error('SNS unavailable'));
  await invoke(handlers.dispatch,message({sessionId:'s',attemptId:'a'}));
  expect(sessions.updateSessionState).toHaveBeenLastCalledWith('s','GENERATING_FEEDBACK','GENERATING_FEEDBACK',
    expect.objectContaining({feedbackJob:expect.objectContaining({status:'PENDING',attempts:1})}));
});

test('a notification insert is delivered once and a completed notification produces no retry',async()=>{
  const report={feedbackId:'f',sessionId:'s',userId:'u',attemptId:'a',notificationStatus:'PENDING',notificationAttempts:0};
  await invoke(handlers.feedback,stream(report));
  expect(queued()[0].body).toMatchObject({kind:'notification',feedbackId:'f'});
  db.on(GetCommand).resolves({Item:report});
  notification.handler.mockResolvedValue({success:true});
  expect(await invoke(handlers.feedback,message({kind:'notification',feedbackId:'f'}))).toEqual({batchItemFailures:[]});
  const updates=writes();
  expect(updates[0].ExpressionAttributeValues).toMatchObject({':attempts':1,':max':5});
  expect(updates.at(-1).ExpressionAttributeValues[':status']).toBe('DELIVERED');
  const count=queued().length;
  await invoke(handlers.feedback,stream({...report,notificationStatus:'DELIVERED'},report));
  expect(queued()).toHaveLength(count);
});

test('a crashed notification owner is revisited after expiry and transient errors stay bounded',async()=>{
  const report={feedbackId:'f',sessionId:'s',userId:'u',notificationStatus:'SENDING',notificationExpiresAt:Date.now()+75000,notificationAttempts:1};
  await invoke(handlers.feedback,stream(report));
  expect(queued()[0].body.dueAt).toBe(report.notificationExpiresAt+1);
  db.on(GetCommand).resolves({Item:{...report,notificationExpiresAt:Date.now()-1,notificationAttempts:4}});
  notification.handler.mockRejectedValue(new Error('FCM unavailable'));
  await invoke(handlers.feedback,message({kind:'notification',feedbackId:'f'}));
  expect(writes().at(-1).ExpressionAttributeValues[':status']).toBe('FAILED');
});

test('feedback timeout is attempt-fenced and needs no later stream write',async()=>{
  db.on(GetCommand).resolves({Item:{sessionId:'s',userId:'u',feedbackAttemptId:'new',feedbackStatus:'PENDING',feedbackAttemptStartedAt:Date.now()-13*60000}});
  await invoke(handlers.feedback,message({kind:'feedbackTimeout',sessionId:'s',attemptId:'old'}));
  expect(writes()).toHaveLength(0);
  await invoke(handlers.feedback,message({kind:'feedbackTimeout',sessionId:'s',attemptId:'new'}));
  expect(writes()[0]).toMatchObject({
    ExpressionAttributeValues:{':attempt':'new',':failed':'FAILED'}
  });
});

test('resume recovery supports stable records without claimedAt and ignores stale attempts',async()=>{
  const resume={resumeId:'r',userId:'u',status:'PARSING',s3Key:'immutable/r.pdf',updatedAt:new Date(Date.now()-4*60000).toISOString()};
  await invoke(handlers.resume,stream(resume));
  expect(queued()[0].body.resumeId).toBe('r');
  db.on(GetCommand).resolves({Item:resume});
  await invoke(handlers.resume,message({resumeId:'r'}));
  const claim=writes()[0];
  expect(claim.ConditionExpression).toContain('attribute_not_exists(parseAttemptId)');
  expect(claim.ConditionExpression).toContain('attribute_not_exists(claimedAt)');
  expect(JSON.parse(Buffer.from(lambda.commandCalls(InvokeCommand)[0].args[0].input.Payload).toString()))
    .toMatchObject({isAsyncWorker:true,resumeId:'r',s3Key:'immutable/r.pdf'});
  db.on(GetCommand).resolves({Item:{...resume,parseAttemptId:'new'}});
  await invoke(handlers.resume,message({resumeId:'r',attemptId:'old'}));
  expect(lambda.commandCalls(InvokeCommand)).toHaveLength(1);
});

test('turn recovery republishes the exact pending job and never consumes the primary queue',async()=>{
  const pendingJob={sessionId:'s',userId:'u',action:'turn_submit',jobId:'t',body:{textTranscript:'accepted answer'}};
  db.on(GetCommand).resolves({Item:{sessionId:'s',userId:'u',jobId:'t',currentState:'PROCESSING_RESPONSE',updatedAt:new Date().toISOString(),pendingJob}});
  await invoke(handlers.turn,message({sessionId:'s',jobId:'t'}));
  expect(queued()[0]).toMatchObject({queue:'primary-interview',body:pendingJob});
  expect(queued()[1]).toMatchObject({queue:'recovery',body:{sessionId:'s',checks:1}});
  expect(db.commandCalls(ScanCommand)).toHaveLength(0);
  expect(db.commandCalls(QueryCommand)).toHaveLength(0);
});

test('live turn leases are respected, while completed and replaced turns stop watchdogs',async()=>{
  db.on(GetCommand).resolves({Item:{sessionId:'s',userId:'u',jobId:'t',currentState:'LOADING_CONTEXT',leaseExpiresAt:Date.now()+75000}});
  await invoke(handlers.turn,message({sessionId:'s',jobId:'t'}));
  expect(queued()).toHaveLength(1);expect(queued()[0].queue).toBe('recovery');
  db.on(GetCommand).resolves({Item:{sessionId:'s',currentState:'USER_RESPONDING'}});
  await invoke(handlers.turn,message({sessionId:'s',jobId:'t'}));
  db.on(GetCommand).resolves({Item:{sessionId:'s',currentState:'PROCESSING_RESPONSE',jobId:'new'}});
  await invoke(handlers.turn,message({sessionId:'s',jobId:'t'}));
  expect(queued()).toHaveLength(1);
});

test('per-record queue failures retry only failed messages; a failed stream checkpoint stops later records',async()=>{
  const handler=work.handler({onStream:async item=>{if(item.jobId==='bad')throw Error('failed');},
    process:async task=>{if(task.bad)throw Error('failed');}});
  expect(await invoke(handler,message({bad:true},'bad'),message({},'good'))).toEqual({batchItemFailures:[{itemIdentifier:'bad'}]});
  expect(await invoke(handler,stream({jobId:'ok'},undefined,'100'),stream({jobId:'bad'},undefined,'101'),stream({jobId:'later'},undefined,'102')))
    .toEqual({batchItemFailures:[{itemIdentifier:'101'}]});
});

test('empty old scheduler events cannot initiate any scan',async()=>{
  for(const handler of Object.values(handlers))await expect(handler({source:'aws.events'})).rejects.toThrow();
  expect(db.commandCalls(ScanCommand)).toHaveLength(0);
});

test('a due deletion claims ownership and completes only that account',async()=>{
  deletion.getDeletion.mockResolvedValue({userId:'u',status:'PENDING',drainUntil:Date.now()-1,checkpoints:{resumes:true}});
  deleteAllUserData.mockResolvedValue({failures:[]});
  db.on(DeleteCommand).resolves({});
  require('../../src/lib/firebase').deleteUser.mockResolvedValue(true);
  expect(await invoke(handlers.deletion,message({userId:'u'}))).toEqual({batchItemFailures:[]});
  expect(deleteAllUserData).toHaveBeenCalledWith('u',expect.objectContaining({completed:{resumes:true}}));
  expect(deletion.setStatus).toHaveBeenLastCalledWith('u','COMPLETE');
  const updates=db.commandCalls(UpdateCommand).map(call=>call.args[0].input);
  expect(updates[0].ConditionExpression).toContain('recoveryExpiresAt <= :now');
  expect(updates.at(-1).ConditionExpression).toBe('recoveryOwner = :owner');
});

test('partial deletion failure retries its SQS message and retains the durable checkpoints',async()=>{
  deletion.getDeletion.mockResolvedValue({userId:'u',status:'RETRYING',drainUntil:0,checkpoints:{resumes:true}});
  deleteAllUserData.mockResolvedValue({failures:['sessions: throttled']});
  expect(await invoke(handlers.deletion,message({userId:'u'}))).toEqual({batchItemFailures:[{itemIdentifier:'message-1'}]});
  expect(deletion.setStatus).toHaveBeenLastCalledWith('u','RETRYING',{categories:['sessions']});
  expect(require('../../src/lib/firebase').deleteUser).toHaveBeenCalledWith('u');
});

test('an active deletion owner is never preempted by duplicate delivery',async()=>{
  const expires=Date.now()+60000;
  deletion.getDeletion.mockResolvedValue({userId:'u',status:'PURGING',drainUntil:0,recoveryExpiresAt:expires});
  await invoke(handlers.deletion,message({userId:'u'}));
  expect(deleteAllUserData).not.toHaveBeenCalled();
  expect(queued()[0].body.dueAt).toBe(expires+1);
});

test('exhausted resume recovery is fenced against a concurrent successful parser',async()=>{
  db.on(GetCommand).resolves({Item:{resumeId:'r',userId:'u',parseAttemptId:'a',status:'PARSING',
    claimedAt:Date.now()-4*60000,parseRecoveryAttempts:3,s3Key:'r.pdf'}});
  await invoke(handlers.resume,message({resumeId:'r',attemptId:'a'}));
  expect(writes()[0]).toMatchObject({ExpressionAttributeValues:{':failed':'FAILED',':parsing':'PARSING',':id':'a'}});
  expect(writes()[0].ConditionExpression).toContain('#s = :parsing');
  expect(lambda.commandCalls(InvokeCommand)).toHaveLength(0);
});

test('turns stop after bounded recovery and missing turn bodies are never replaced by initialization',async()=>{
  db.on(GetCommand).resolves({Item:{sessionId:'s',userId:'u',currentState:'LOADING_CONTEXT',version:3,jobAttemptCount:3}});
  await invoke(handlers.turn,message({sessionId:'s'}));
  expect(sessions.updateSessionState).toHaveBeenLastCalledWith('s','ERROR','LOADING_CONTEXT',
    expect.objectContaining({expectedVersion:3,terminationReason:'TURN_RECOVERY_EXHAUSTED'}));
  db.on(GetCommand).resolves({Item:{sessionId:'s',userId:'u',currentState:'PROCESSING_RESPONSE',version:4}});
  await invoke(handlers.turn,message({sessionId:'s'}));
  expect(sessions.updateSessionState).toHaveBeenLastCalledWith('s','ERROR','PROCESSING_RESPONSE',
    expect.objectContaining({terminationReason:'TURN_RECOVERY_PAYLOAD_MISSING'}));
  expect(queued()).toHaveLength(0);
});

test('audio cleanup is armed once per meaningful change and retries failures without sweeping history',async()=>{
  const session={sessionId:'s',userId:'u',answerAudio:{a:{key:'private.wav'}},answerAudioClosed:true,
    answerAudioCleanupPending:true,answerAudioLastExpiry:Date.now()-100000};
  await invoke(handlers.dispatch,stream(session,{...session,answerAudioCleanupPending:false}));
  expect(queued()[0]).toMatchObject({queue:'feedback-recovery',body:{kind:'audioCleanup',sessionId:'s'}});
  expect(JSON.stringify(queued()[0])).not.toContain('private.wav');
  await invoke(handlers.dispatch,stream(session,{...session,updatedAt:'old'}));
  expect(queued()).toHaveLength(1);
});

test('queue publication errors retain the stream checkpoint instead of losing work',async()=>{
  sqs.on(SendMessageCommand).rejects(new Error('SQS unavailable'));
  expect(await invoke(handlers.analysis,stream({jobId:'j',status:'PENDING'},undefined,'101')))
    .toEqual({batchItemFailures:[{itemIdentifier:'101'}]});
});

test('an outbox check cannot dispatch a replacement attempt after its second consistent read',async()=>{
  const old={sessionId:'s',userId:'u',feedbackAttemptId:'old',currentState:'GENERATING_FEEDBACK',
    feedbackJobUpdatedAt:Date.now()-70000,feedbackJob:{status:'PENDING',attempts:0}};
  sessions.getSession.mockResolvedValueOnce(old).mockResolvedValueOnce({...old,feedbackAttemptId:'new'});
  await invoke(handlers.dispatch,message({sessionId:'s',attemptId:'old'}));
  expect(dispatch.publishFeedbackJob).not.toHaveBeenCalled();
});

test('a legacy PARSING row without timestamps does not perpetually postpone recovery',async()=>{
  const row={resumeId:'r',userId:'u',status:'PARSING',s3Key:'legacy.pdf'};
  db.on(GetCommand).resolves({Item:row});
  await invoke(handlers.resume,stream(row));
  expect(queued()[0].delay).toBe(0);
  await invoke(handlers.resume,message({resumeId:'r'}));
  expect(lambda.commandCalls(InvokeCommand)).toHaveLength(1);
});

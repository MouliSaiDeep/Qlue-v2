jest.mock('../../src/lib/firebase',()=>({getAuth:jest.fn(),deleteUser:jest.fn()}));
jest.mock('../../src/lib/deletionJob',()=>({getDeletion:jest.fn(),requestDeletion:jest.fn(),checkpoint:jest.fn()}));
jest.mock('../../src/lib/eventWork',()=>({enqueue:jest.fn()}));
jest.mock('../../src/models/wsConnection',()=>({deactivateConnectionsByUserId:jest.fn()}));
const firebase=require('../../src/lib/firebase');
const jobs=require('../../src/lib/deletionJob');
const work=require('../../src/lib/eventWork');
const sockets=require('../../src/models/wsConnection');
const {handler}=require('../../src/handlers/auth/deleteAccount');
const proof=jest.fn();
const call=async(extra={})=>{
  const response=await handler({headers:{Authorization:'Bearer signed-proof'},body:JSON.stringify({confirmation:'DELETE'}),...extra});
  return {...response,data:JSON.parse(response.body)};
};
beforeEach(()=>{
  jest.resetAllMocks();
  proof.mockResolvedValue({uid:'owner',auth_time:Math.floor(Date.now()/1000),email_verified:false});
  firebase.getAuth.mockResolvedValue({verifyIdToken:proof});
  firebase.deleteUser.mockResolvedValue(true);
  jobs.requestDeletion.mockResolvedValue({userId:'owner',status:'PENDING',drainUntil:Date.now()+1200000});
});
test('public route requires a signed identity even when authorizer or body claims a UID',async()=>{
  expect((await call({headers:{},requestContext:{authorizer:{uid:'victim'}}})).statusCode).toBe(401);
  expect(jobs.requestDeletion).not.toHaveBeenCalled();
  expect(firebase.deleteUser).not.toHaveBeenCalled();
});
test('rejects invalid or expired signatures even if a deletion job exists',async()=>{
  proof.mockRejectedValue(new Error('invalid token'));jobs.getDeletion.mockResolvedValue({status:'PENDING'});
  expect((await call()).statusCode).toBe(401);
  expect(jobs.getDeletion).not.toHaveBeenCalled();
  expect(firebase.deleteUser).not.toHaveBeenCalled();
});
test.each([undefined,NaN,Date.now()/1000-301,Date.now()/1000+61])('requires recent reauthentication (%s)',async(auth_time)=>{
  proof.mockResolvedValue({uid:'owner',auth_time});
  expect((await call()).statusCode).toBe(401);
  expect(jobs.requestDeletion).not.toHaveBeenCalled();
});
test('requires explicit confirmation and rejects malformed JSON without deleting anything',async()=>{
  expect((await call({body:'{}'})).statusCode).toBe(400);
  expect((await call({body:'{'})).statusCode).toBe(400);
  expect(firebase.deleteUser).not.toHaveBeenCalled();
});
test('unverified user can delete only their signed UID, after durable persistence',async()=>{
  const result=await call({body:JSON.stringify({confirmation:'DELETE',userId:'victim'}),requestContext:{authorizer:{uid:'victim'}}});
  expect(result.statusCode).toBe(202);
  expect(result.data).toMatchObject({deletionAccepted:true,identityDeleted:true,status:'PENDING'});
  expect(jobs.requestDeletion).toHaveBeenCalledWith('owner');
  expect(firebase.deleteUser).toHaveBeenCalledWith('owner');
  expect(jobs.requestDeletion.mock.invocationCallOrder[0]).toBeLessThan(firebase.deleteUser.mock.invocationCallOrder[0]);
  expect(work.enqueue).toHaveBeenCalledWith({worker:'deletion',userId:'owner'},expect.any(Number));
  expect(sockets.deactivateConnectionsByUserId).toHaveBeenCalledWith('owner');
  expect(result.headers['Cache-Control']).toBe('no-store');
});
test('a persistence failure never strands cleanup by deleting Firebase first',async()=>{
  jobs.requestDeletion.mockRejectedValue(new Error('ddb unavailable'));
  expect((await call()).statusCode).toBe(503);
  expect(firebase.deleteUser).not.toHaveBeenCalled();
  expect(work.enqueue).not.toHaveBeenCalled();
});
test('Firebase failure is honestly pending with durable automatic recovery',async()=>{
  firebase.deleteUser.mockRejectedValue(new Error('transient'));
  const result=await call();
  expect(result.statusCode).toBe(202);
  expect(result.data).toMatchObject({deletionAccepted:true,identityDeleted:false,status:'PENDING'});
  expect(jobs.checkpoint).not.toHaveBeenCalled();
  expect(work.enqueue).toHaveBeenCalled();
});
test('queue or socket failures retain the stream-backed deletion request',async()=>{
  work.enqueue.mockRejectedValue(new Error('queue unavailable'));
  sockets.deactivateConnectionsByUserId.mockRejectedValue(new Error('socket update unavailable'));
  expect((await call()).data).toMatchObject({deletionAccepted:true,identityDeleted:true});
  expect(jobs.requestDeletion).toHaveBeenCalled();
});
test('lost-response retry accepts a signed recent token only for an existing deletion',async()=>{
  proof.mockRejectedValueOnce(new Error('auth/user-not-found'));
  jobs.getDeletion.mockResolvedValue({userId:'owner',status:'COMPLETE',drainUntil:1});
  firebase.deleteUser.mockResolvedValue(false); // Already absent is idempotent success.
  const result=await call();
  expect(result.statusCode).toBe(200);
  expect(result.data.identityDeleted).toBe(true);
  expect(proof).toHaveBeenNthCalledWith(1,'signed-proof',true);
  expect(proof).toHaveBeenNthCalledWith(2,'signed-proof',false);
  expect(jobs.getDeletion).toHaveBeenCalledWith('owner');
  expect(jobs.requestDeletion).not.toHaveBeenCalled();
  expect(work.enqueue).not.toHaveBeenCalled();
});
test('a revoked token cannot start a new deletion',async()=>{
  proof.mockRejectedValueOnce(new Error('auth/id-token-revoked'));
  expect((await call()).statusCode).toBe(401);
  expect(jobs.requestDeletion).not.toHaveBeenCalled();
  expect(firebase.deleteUser).not.toHaveBeenCalled();
});

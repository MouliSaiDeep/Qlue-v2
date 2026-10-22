jest.mock('../../src/models/session',()=>({getSessionById:jest.fn(),INTERVIEW_STATES:{TERMINATED:'TERMINATED',GENERATING_FEEDBACK:'GENERATING_FEEDBACK'}}));
jest.mock('../../src/lib/deletionJob',()=>({assertNotDeleting:jest.fn()}));
jest.mock('../../src/lib/paidWork',()=>({assertRuntimeEnabled:jest.fn()}));
jest.mock('../../src/lib/quota',()=>({reserveQuota:jest.fn()}));
jest.mock('../../src/lib/feedbackAttempt',()=>({claim:jest.fn()}));
jest.mock('../../src/lib/dynamodb',()=>({get:jest.fn()}));
const {handler}=require('../../src/handlers/feedback/regenerateFeedback');
const session=require('../../src/models/session'),db=require('../../src/lib/dynamodb'),attempt=require('../../src/lib/feedbackAttempt'),quota=require('../../src/lib/quota');
const event=refreshAssessment=>({requestContext:{authorizer:{uid:'owner'}},body:JSON.stringify({sessionId:'s',refreshAssessment})});
beforeEach(()=>{
 jest.clearAllMocks();session.getSessionById.mockResolvedValue({sessionId:'s',userId:'owner',currentState:'TERMINATED',feedbackStatus:'COMPLETE',feedbackId:'old'});
 db.get.mockResolvedValue({success:true,data:{sessionId:'s',userId:'owner',feedbackId:'old',reportVersion:'content-rubric-v2',analysisStatus:'OK',dimensionScores:{Relevance:25},assessment:{}}});
 quota.reserveQuota.mockResolvedValue({allowed:true});attempt.claim.mockResolvedValue({attemptId:'new'});
});
test('an explicit refresh can repair an owned older assessment while retaining the retry quota and attempt fence',async()=>{
 expect((await handler(event(true))).statusCode).toBe(202);expect(quota.reserveQuota).toHaveBeenCalledWith('owner','feedback');
 expect(attempt.claim).toHaveBeenCalledWith(expect.objectContaining({userId:'owner',feedbackId:'old'}),{retryReportId:'old'});
});
test('normal completed reports are not regenerated implicitly',async()=>{
 expect((await handler(event(false))).statusCode).toBe(200);expect(attempt.claim).not.toHaveBeenCalled();expect(quota.reserveQuota).not.toHaveBeenCalled();
});
test('the current coaching revision cannot be repeatedly regenerated for free',async()=>{
 db.get.mockResolvedValue({success:true,data:{sessionId:'s',userId:'owner',reportVersion:'content-rubric-v2',dimensionScores:{Relevance:75},assessment:{coachingVersion:require('../../src/lib/feedbackCoaching').VERSION}}});
 expect((await handler(event(true))).statusCode).toBe(200);expect(quota.reserveQuota).not.toHaveBeenCalled();
});
test('the prior coaching revision can be refreshed once through the same quota and ownership guards',async()=>{
 db.get.mockResolvedValue({success:true,data:{sessionId:'s',userId:'owner',reportVersion:'content-rubric-v2',dimensionScores:{Relevance:75},assessment:{coachingVersion:'answer-specific-v1'}}});
 expect((await handler(event(true))).statusCode).toBe(202);expect(quota.reserveQuota).toHaveBeenCalledWith('owner','feedback');
});
test('refresh cannot cross account ownership or bypass a depleted retry allowance',async()=>{
 session.getSessionById.mockResolvedValueOnce({sessionId:'s',userId:'another'});
 expect((await handler(event(true))).statusCode).toBe(403);expect(db.get).not.toHaveBeenCalled();
 quota.reserveQuota.mockResolvedValueOnce({allowed:false});expect((await handler(event(true))).statusCode).toBe(429);expect(attempt.claim).not.toHaveBeenCalled();
});

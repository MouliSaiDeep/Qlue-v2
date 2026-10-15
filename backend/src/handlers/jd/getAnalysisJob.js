const response=require('../../lib/response');
exports.handler=async event=>{
  const uid=event.requestContext?.authorizer?.uid;
  if(!uid) return response.unauthorized('Please sign in');
  await require('../../lib/deletionJob').assertNotDeleting(uid);
  const job=await require('../../lib/analysisJobs').get(event.pathParameters?.jobId);
  if(!job||job.userId!==uid) return response.notFound('Analysis request not found');
  return response.success({jobId:job.jobId,status:job.status,result:job.result});
};

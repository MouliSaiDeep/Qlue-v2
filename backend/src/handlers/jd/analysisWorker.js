const jobs=require('../../lib/analysisJobs');
exports.handler=(event,context)=>require('../../lib/deadline').withDeadline(context,()=>event.jobId?jobs.run(event.jobId):jobs.recover(),{maxMs:120000,reserveMs:10000});

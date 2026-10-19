const jobs = require('../../lib/analysisJobs');
const work = require('../../lib/eventWork');

async function processJob({ jobId }) {
  if (!jobId) throw new Error('Analysis jobId is required');
  const job = await jobs.get(jobId);
  // FAILED is terminal; an explicit reset to PENDING can retry it.
  if (!job || !['PENDING', 'RUNNING'].includes(job.status)) return;
  if (job.status === 'RUNNING' && job.leaseExpiresAt >= Date.now()) {
    return work.enqueue({ jobId }, job.leaseExpiresAt + 1);
  }
  return jobs.run(jobId);
}

exports.handler = work.handler({worker:'analysis',
  maxMs: 120000,
  onStream: async (job, old) => {
    if (!job.jobId || !['PENDING', 'RUNNING'].includes(job.status) ||
      !work.changed(job, old, ['status', 'leaseExpiresAt'])) return;
    await work.enqueue({ jobId: job.jobId }, job.status === 'RUNNING' ? job.leaseExpiresAt + 1 : Date.now());
  },
  process: processJob,
  direct: processJob
});

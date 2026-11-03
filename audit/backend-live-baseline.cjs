// Read-only inventory: no provider calls, wake requests, customer scans, token
// printing, environment values or resource changes. Store evidence privately.
const fs = require('node:fs');
const path = require('node:path');
const { execFile } = require('node:child_process');
const { sha256 } = require('./release-manifest.cjs');
function aws(args, region) {
  return new Promise((resolve, reject) => execFile('aws', [...args, '--region', region, '--output', 'json',
    '--cli-connect-timeout', '5', '--cli-read-timeout', '10'], { timeout: 20000, maxBuffer: 8 * 1024 * 1024,
    windowsHide: true }, (error, stdout) => {
    if (error) return reject(Object.assign(Error('Read-only AWS inventory request failed'), { code: error.code }));
    try { resolve(JSON.parse(stdout)); } catch (_) { reject(Error('Invalid AWS response')); }
  }));
}
async function inventory({ stack = 'qlue-dev', region = 'us-east-1', read = args => aws(args, region) } = {}) {
  const [{ Stacks }, { StackResourceSummaries: resources }] = await Promise.all([
    read(['cloudformation', 'describe-stacks', '--stack-name', stack]),
    read(['cloudformation', 'list-stack-resources', '--stack-name', stack])
  ]);
  const state = Stacks[0], selected = new Set(['TerminateSessionFunction', 'StoreFeedbackReportFunction',
    'AnalyzeTranscriptFunction', 'GenerateFeedbackReportFunction', 'RecoverFeedbackFunction',
    'RecoverTurnsFunction', 'AsyncInterviewWorkerFunction', 'SttTicketFunction']);
  const functions = [];
  for (const resource of resources.filter(r => selected.has(r.LogicalResourceId))) {
    const data = await read(['lambda', 'get-function-configuration', '--function-name', resource.PhysicalResourceId]);
    functions.push({ logicalId: resource.LogicalResourceId, runtime: data.Runtime, architectures: data.Architectures,
      lastModified: data.LastModified, codeSha256: data.CodeSha256, revisionId: data.RevisionId,
      timeout: data.Timeout, memorySize: data.MemorySize,
      configurationSha256: sha256(JSON.stringify({ environment: data.Environment?.Variables || {},
        layers: data.Layers?.map(l => l.Arn) || [], role: data.Role })) });
  }
  const controlTable = resources.find(r => r.LogicalResourceId === 'SttSessionsTable');
  let control = null;
  if (controlTable) {
    const data = await read(['dynamodb', 'get-item', '--table-name', controlTable.PhysicalResourceId,
      '--key', '{"pk":{"S":"CONTROL"}}', '--consistent-read',
      '--projection-expression', 'rolloutEnabled,globalStreamSlots,dailyStreamLimit']);
    control = { rolloutEnabled: data.Item?.rolloutEnabled?.BOOL ?? null,
      globalStreamSlots: data.Item?.globalStreamSlots?.N ?? null,
      dailyStreamLimit: data.Item?.dailyStreamLimit?.N ?? null };
  }
  let quotas;
  try {
    const data = await read(['service-quotas', 'list-service-quotas', '--service-code', 'transcribe']);
    quotas = (data.Quotas || []).filter(q => /concurrent.*stream|stream.*concurrent/i.test(q.QuotaName))
      .map(q => ({ name: q.QuotaName, value: q.Value, adjustable: q.Adjustable }));
  } catch (_) { quotas = null; }
  return { schemaVersion: 1, observedAt: new Date().toISOString(), stack, region,
    stackStatus: state.StackStatus, lastUpdated: state.LastUpdatedTime,
    functions, control, transcribeStreamingQuotas: quotas,
    alarmDefinitions: resources.filter(r => r.ResourceType === 'AWS::CloudWatch::Alarm').map(r => r.LogicalResourceId),
    providerCalls: 0, resourceChanges: 0 };
}
if (require.main === module) {
  const [output, ...extra] = process.argv.slice(2);
  if (!output || extra.length) throw Error('Use: backend-live-baseline.cjs OUTPUT.json');
  inventory().then(value => {
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, JSON.stringify(value, null, 2) + '\n');
    console.log(JSON.stringify({ output, stackStatus: value.stackStatus, functions: value.functions.length,
      control: value.control, streamingQuotas: value.transcribeStreamingQuotas, providerCalls: 0, resourceChanges: 0 }));
  }).catch(error => { console.error(error.message); process.exitCode = 1; });
}
module.exports = { inventory };

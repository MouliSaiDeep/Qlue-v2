const fs = require('node:fs');
const path = require('node:path');
const { promisify } = require('node:util');
const execFile = promisify(require('node:child_process').execFile);
const dir = path.resolve(__dirname, '../tmp/deploy-otp-2026-10-18');
const phase = process.argv[2];
const changeSet = process.argv[3];
if (!['paused', 'iam-fix', 'active'].includes(phase) || !changeSet) throw Error('Use paused|iam-fix|active change-set-arn');
const load = f => JSON.parse(fs.readFileSync(path.join(dir, f), 'utf8').replace(/^\uFEFF/, ''));
const body = x => typeof x.TemplateBody === 'string' ? JSON.parse(x.TemplateBody) : x.TemplateBody;
async function aws(args) {
  const { stdout } = await execFile('C:/Program Files/Amazon/AWSCLIV2/aws.exe', [...args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager', '--cli-connect-timeout', '5', '--cli-read-timeout', '20'], { timeout: 35000, maxBuffer: 20 * 1024 * 1024 });
  return JSON.parse(stdout);
}
(async () => {
  const changes = await aws(['cloudformation', 'describe-change-set', '--change-set-name', changeSet, '--stack-name', 'qlue-dev']);
  const template = await aws(['cloudformation', 'get-template', '--stack-name', 'qlue-dev', '--change-set-name', changeSet, '--template-stage', 'Processed']);
  fs.writeFileSync(path.join(dir, phase + '-changeset.json'), JSON.stringify(changes, null, 2));
  fs.writeFileSync(path.join(dir, phase + '-processed.json'), JSON.stringify(template, null, 2));
  if (changes.Status !== 'CREATE_COMPLETE' || changes.ExecutionStatus !== 'AVAILABLE') throw Error('Change set not ready');
  const before = body(load(phase === 'paused' ? 'live-processed.json' : 'paused-processed.json'));
  const after = body(template), risks = [], summary = [];
  const expectedMapping = 'UpdateGlobalProfileFunctionFeedbackStream';
  for (const { ResourceChange: r } of changes.Changes) {
    summary.push({ id: r.LogicalResourceId, type: r.ResourceType, action: r.Action, replacement: r.Replacement });
    if (r.Action === 'Remove' && !['AWS::Events::Rule', 'AWS::Lambda::Permission', 'AWS::Lambda::LayerVersion', 'AWS::ApiGateway::Deployment'].includes(r.ResourceType)) risks.push('Unexpected removal: ' + r.LogicalResourceId);
    if (r.Replacement === 'True' && !(r.ResourceType === 'AWS::Lambda::EventSourceMapping' && r.LogicalResourceId === expectedMapping)) risks.push('Unexpected replacement: ' + r.LogicalResourceId);
    if (['AWS::DynamoDB::Table', 'AWS::S3::Bucket', 'AWS::SQS::Queue', 'AWS::Cognito::UserPool'].includes(r.ResourceType) && r.Action !== 'Add' && (r.Replacement !== 'False' || r.Action !== 'Modify')) risks.push('Durable resource change: ' + r.LogicalResourceId);
    if (phase === 'active' && (r.Action !== 'Modify' || !['AWS::SSM::Parameter', 'AWS::Lambda::EventSourceMapping'].includes(r.ResourceType))) risks.push('Unexpected activation change: ' + r.LogicalResourceId);
    if (phase === 'iam-fix') {
      const role = r.ResourceType === 'AWS::IAM::Role' && ['SendEmailOtpFunctionRole', 'VerifyEmailOtpFunctionRole'].includes(r.LogicalResourceId);
      const dependency = ['RestApi', 'SendEmailOtpFunction', 'VerifyEmailOtpFunction'].includes(r.LogicalResourceId) &&
        JSON.stringify(before.Resources[r.LogicalResourceId]) === JSON.stringify(after.Resources[r.LogicalResourceId]) &&
        r.Details.every(d => d.Evaluation === 'Dynamic' && d.ChangeSource === 'ResourceAttribute');
      if (r.Action !== 'Modify' || (!role && !dependency)) risks.push('Unexpected permission repair: ' + r.LogicalResourceId);
    }
  }
  for (const [id, r] of Object.entries(before.Resources)) {
    if (r.Type !== 'AWS::Lambda::Function') continue;
    const next = after.Resources[id];
    if (!next) { risks.push('Existing function removed: ' + id); continue; }
    for (const [name, value] of Object.entries(r.Properties.Environment?.Variables || {})) {
      if (JSON.stringify(next.Properties.Environment?.Variables[name]) !== JSON.stringify(value)) risks.push('Existing environment changed: ' + id + '.' + name);
    }
  }
  const mappings = Object.entries(after.Resources).filter(([, r]) => r.Type === 'AWS::Lambda::EventSourceMapping');
  if (mappings.length !== 8 || mappings.some(([, r]) => r.Properties.Enabled !== (phase === 'active'))) risks.push('Unexpected mapping count or activation state');
  if (Object.values(after.Resources).some(r => r.Type === 'AWS::Events::Rule')) risks.push('Polling rules remain');
  if (after.Resources.PaidOpsSwitch.Properties.Value !== (phase === 'active' ? 'none' : 'all')) risks.push('Wrong stop-switch state');
  const report = { phase, reviewedAt: new Date().toISOString(), changes: summary.length, mappings: mappings.length, risks, resources: summary };
  fs.writeFileSync(path.join(dir, phase + '-review.json'), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
  if (risks.length) process.exitCode = 1;
})().catch(e => { console.error(e.message); process.exitCode = 1; });

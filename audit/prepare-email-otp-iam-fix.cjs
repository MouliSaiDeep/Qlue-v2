const fs = require('node:fs'), path = require('node:path');
const { promisify } = require('node:util'), execFile = promisify(require('node:child_process').execFile);
const read = require('./read-cfn.cjs');
const dir = path.resolve(__dirname, '../tmp/deploy-otp-2026-10-18');
async function aws(args) {
  const { stdout } = await execFile('C:/Program Files/Amazon/AWSCLIV2/aws.exe', [...args, '--region', 'us-east-1', '--output', 'json', '--no-cli-pager'], { timeout: 35000, maxBuffer: 20 * 1024 * 1024 });
  return stdout.trim() ? JSON.parse(stdout) : {};
}
(async () => {
  const pending = JSON.parse(fs.readFileSync(path.join(dir, 'active-preparation.json')));
  await aws(['cloudformation', 'delete-change-set', '--stack-name', 'qlue-dev', '--change-set-name', pending.Id]);
  const original = await aws(['cloudformation', 'get-template', '--stack-name', 'qlue-dev', '--template-stage', 'Original']);
  const template = typeof original.TemplateBody === 'string' ? read(original.TemplateBody) : original.TemplateBody;
  const canonical = read(fs.readFileSync(path.resolve(__dirname, '../backend/template.yaml'), 'utf8'));
  for (const id of ['SendEmailOtpFunction', 'VerifyEmailOtpFunction']) template.Resources[id].Properties.Policies = canonical.Resources[id].Properties.Policies;
  const file = path.join(dir, 'iam-fix-packaged-template.json'); fs.writeFileSync(file, JSON.stringify(template, null, 2));
  const code = template.Resources.RegisterUserFunction.Properties.CodeUri;
  const bucket = typeof code === 'string' ? /^s3:\/\/([^/]+)\//.exec(code)?.[1] : code.Bucket;
  const key = 'qlue-dev/deploy-otp-iam-fix-' + Date.now() + '.template';
  await aws(['s3api', 'put-object', '--bucket', bucket, '--key', key, '--body', file, '--server-side-encryption', 'AES256']);
  const stack = (await aws(['cloudformation', 'describe-stacks', '--stack-name', 'qlue-dev'])).Stacks[0];
  const result = await aws(['cloudformation', 'create-change-set', '--stack-name', 'qlue-dev', '--change-set-name', 'qlue-otp-iam-fix-' + Date.now(), '--change-set-type', 'UPDATE',
    '--template-url', `https://${bucket}.s3.us-east-1.amazonaws.com/${key}`, '--capabilities', 'CAPABILITY_IAM',
    '--parameters', JSON.stringify(stack.Parameters.map(p => ({ ParameterKey: p.ParameterKey, UsePreviousValue: true })))]);
  fs.writeFileSync(path.join(dir, 'iam-fix-preparation.json'), JSON.stringify(result, null, 2)); console.log(JSON.stringify(result));
})().catch(e => { console.error(e.message); process.exitCode = 1; });

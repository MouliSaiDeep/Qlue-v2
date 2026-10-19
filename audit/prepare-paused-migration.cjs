// Local preparation only: no AWS calls, secrets, packaging or deployment.
const fs = require('node:fs'), path = require('node:path');
const read = require('./read-cfn.cjs');
function pinAdoptedLogs(result, baseline) {
  const pinnedLogs=[];
  if (!baseline)return pinnedLogs;
  baseline=baseline.TemplateBody ?? baseline;
  if(typeof baseline==='string')baseline=JSON.parse(baseline);
  for(const [id, existing]of Object.entries(baseline.Resources)) {
    if(existing.Type!=='AWS::Logs::LogGroup')continue;
    const target=result.Resources[id];
    if(!target||target.Type!==existing.Type)throw new Error('Adopted log group missing from migration: '+id);
    const name=existing.Properties?.LogGroupName;
    if(typeof name!=='string'){
      if(JSON.stringify(name)!==JSON.stringify(target.Properties.LogGroupName))throw new Error('Existing log-name expression changed: '+id);
      continue;
    }
    if(!name.startsWith('/aws/lambda/qlue-dev-'))throw new Error('Require exact adopted physical log name: '+id);
    target.Properties.LogGroupName=name;pinnedLogs.push(id);
  }
  return pinnedLogs;
}
function pausedTemplate(template, baseline) {
  const result = structuredClone(template), paused = [];
  if (result.Resources.PaidOpsSwitch?.Type !== 'AWS::SSM::Parameter') throw new Error('Missing runtime stop switch');
  result.Resources.PaidOpsSwitch.Properties.Value = 'all';
  for (const [id, resource] of Object.entries(result.Resources)) {
    for (const [event, definition] of Object.entries(resource.Properties?.Events ?? {})) {
      if (!['Schedule', 'ScheduleV2', 'DynamoDB', 'SQS'].includes(definition.Type)) continue;
      if (definition.Type === 'ScheduleV2') definition.Properties.State = 'DISABLED';
      else definition.Properties.Enabled = false;
      paused.push(`${id}.${event}`);
    }
    if (resource.Type === 'AWS::Events::Rule') {
      resource.Properties.State = 'DISABLED'; paused.push(id);
    }
  }
  if (!paused.length) throw new Error('No background event sources found: inspect migration template');
  const pinnedLogs=pinAdoptedLogs(result,baseline);
  return {template:result, paused, pinnedLogs};
}
module.exports = {pausedTemplate,pinAdoptedLogs};
if (require.main === module) {
  const source = path.resolve(__dirname,'../backend/template.yaml');
  const out = path.resolve(__dirname,'../backend/template-migration.yaml');
  const baseline=process.argv[2]?JSON.parse(fs.readFileSync(process.argv[2],'utf8').replace(/^\uFEFF/,'')):undefined;
  const {template, paused, pinnedLogs} = pausedTemplate(read(fs.readFileSync(source,'utf8')),baseline);
  fs.writeFileSync(out, JSON.stringify(template,null,2)+'\n');
  console.log(JSON.stringify({output:'backend/template-migration.yaml', stopSwitch:'all', paused, pinnedLogs:pinnedLogs.length},null,2));
}

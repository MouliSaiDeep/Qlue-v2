// Offline preparation only. Never invokes AWS or executes an import.
// Input must be the EXACT deployed Processed template, not the new SAM template.
const fs = require('node:fs'), path = require('node:path');
const [baselineFile, metadataFile, outputDirectory] = process.argv.slice(2);
if (!baselineFile || !metadataFile || !outputDirectory) {
  throw new Error('Usage: node audit/prepare-log-adoption.cjs deployed-processed.json live-summary.json output-directory');
}
let baseline = JSON.parse(fs.readFileSync(baselineFile, 'utf8').replace(/^\uFEFF/, ''));
if (baseline.TemplateBody) baseline = baseline.TemplateBody;
if (typeof baseline === 'string') baseline = JSON.parse(baseline);
if (!baseline.Resources || Object.values(baseline.Resources).some(r => r.Type?.startsWith('AWS::Serverless::'))) {
  throw new Error('Use the deployed Processed CloudFormation JSON template; no new application changes may accompany IMPORT.');
}
const metadata = JSON.parse(fs.readFileSync(metadataFile, 'utf8').replace(/^\uFEFF/, ''));
const local = fs.readFileSync(path.resolve(__dirname, '../backend/template.yaml'), 'utf8');
const blocks = [...local.matchAll(/^  (\w+LogGroup):\r?\n([\s\S]*?)(?=^  \w+:|$(?![\s\S]))/gm)];
const imports = [];
for (const [, logical, body] of blocks) {
  const fn = body.match(/LogGroupName: !Sub '\/aws\/lambda\/\$\{(\w+)\}'/)?.[1];
  if (!fn) throw new Error(`Unsupported log resource ${logical}`);
  const physical = metadata.lambdaResources.find(r => r.logical === fn)?.physical;
  const name = physical && `/aws/lambda/${physical}`;
  const existing = metadata.logs.find(r => r.name === name);
  if (!existing) continue; // new functions get new groups during normal UPDATE
  if (!baseline.Resources[fn] || baseline.Resources[fn].Type !== 'AWS::Lambda::Function') throw new Error(`Missing deployed function ${fn}`);
  if (baseline.Resources[logical]) throw new Error(`Already managed log group ${logical}; inspect ownership before importing`);
  const properties = {LogGroupName: name};
  // IMPORT does not update resources. Mirror current retention; the subsequent
  // reviewed UPDATE applies 30 days, after ownership has been established.
  if (existing.retentionDays != null) properties.RetentionInDays = existing.retentionDays;
  baseline.Resources[logical] = {Type:'AWS::Logs::LogGroup',DeletionPolicy:'Retain',UpdateReplacePolicy:'Retain',Properties:properties};
  imports.push({ResourceType:'AWS::Logs::LogGroup',LogicalResourceId:logical,ResourceIdentifier:{LogGroupName:name}});
}
if (!imports.length) throw new Error('No unmanaged deployed log groups matched; refresh metadata and inspect ownership');
fs.mkdirSync(outputDirectory, {recursive:true});
fs.writeFileSync(path.join(outputDirectory, 'import-template.json'), JSON.stringify(baseline,null,2)+'\n');
fs.writeFileSync(path.join(outputDirectory, 'resources-to-import.json'), JSON.stringify(imports,null,2)+'\n');
console.log(JSON.stringify({preparedLogGroups:imports.length,awsMutations:0}));

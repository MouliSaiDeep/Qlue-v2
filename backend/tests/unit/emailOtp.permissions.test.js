const fs = require('node:fs');
const path = require('node:path');
const read = require('../../../audit/read-cfn.cjs');
const template = read(fs.readFileSync(path.resolve(__dirname, '../../template.yaml'), 'utf8'));

test.each(['SendEmailOtpFunction', 'VerifyEmailOtpFunction'])('%s can atomically check the account deletion fence', id => {
  const statements = template.Resources[id].Properties.Policies.flatMap(policy => policy.Statement || []);
  expect(statements).toContainEqual({ Effect: 'Allow', Action: ['dynamodb:ConditionCheckItem'], Resource: { 'Fn::GetAtt': ['DeletionJobsTable', 'Arn'] } });
});

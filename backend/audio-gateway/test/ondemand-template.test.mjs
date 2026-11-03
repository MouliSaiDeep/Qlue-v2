import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const require=createRequire(import.meta.url);
const {build}=require('../ondemand/template.cjs');
test('capacity changes retain an explicit AMI and a bounded rendered stream ceiling',()=>{
 const t=build();assert.equal(t.Parameters.ImageId.Type,'String');assert.equal(t.Parameters.ImageId.Default,undefined);
 const pattern=new RegExp(t.Parameters.ImageId.AllowedPattern);assert.ok(pattern.test('ami-0123456789abcdef0'));assert.ok(!pattern.test('/aws/service/ami-latest'));
 assert.deepEqual(t.Parameters.GlobalStreamSlots,{Type:'Number',Default:8,MinValue:1,MaxValue:20});
 const parts=t.Resources.Host.Properties.UserData['Fn::Base64']['Fn::Join'][1];assert.ok(parts.some(p=>p?.Ref==='GlobalStreamSlots'));
 assert.ok(!parts.some(p=>typeof p==='string'&&p.includes('{{')));
 const policy=require('../ondemand/stack-policy.json');assert.ok(policy.Statement.some(s=>s.Effect==='Deny'&&s.Resource==='LogicalResourceId/Host'&&s.Action.includes('Update:Replace')&&s.Action.includes('Update:Delete')));
});

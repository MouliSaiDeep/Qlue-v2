import test from 'node:test';
import assert from 'node:assert/strict';
import { secureIngress } from '../src/ingress.mjs';

test('direct ALB TLS remains the default and fails closed for missing or HTTP forwarding', () => {
  assert.equal(secureIngress({'x-forwarded-proto':'https'}), true);
  assert.equal(secureIngress({'x-forwarded-proto':'http'}), false);
  assert.equal(secureIngress({}), false);
  assert.equal(secureIngress({'x-forwarded-proto':'https'}, 'unknown'), false);
});
test('private CloudFront ingress requires the explicit mode and overwritten HTTPS viewer header', () => {
  const h = {'x-forwarded-proto':'http', 'x-qlue-viewer-proto':'https'};
  assert.equal(secureIngress(h, 'cloudfront-vpc'), true);
  assert.equal(secureIngress(h), false);
  assert.equal(secureIngress({'x-forwarded-proto':'http'}, 'cloudfront-vpc'), false);
  assert.equal(secureIngress({...h, 'x-qlue-viewer-proto':'http'}, 'cloudfront-vpc'), false);
});
test('EC2 private-origin mode requires the CloudFront overwritten viewer header',()=>{
  assert.equal(secureIngress({'x-qlue-viewer-proto':'https'},'cloudfront-ec2'),true);
  assert.equal(secureIngress({'x-forwarded-proto':'https'},'cloudfront-ec2'),false);
  assert.equal(secureIngress({'x-qlue-viewer-proto':'http'},'cloudfront-ec2'),false);
});

const response=require('../../src/lib/response');

test.each([
  ['tooManyRequests',429,'QUOTA_EXCEEDED'],
  ['serviceUnavailable',503,'SERVICE_UNAVAILABLE']
])('%s returns the documented recovery response instead of throwing', (name,status,code)=>{
  const result=response[name]('Please retry.');
  expect(result.statusCode).toBe(status);
  expect(JSON.parse(result.body)).toEqual({success:false,error:'Please retry.',code});
  expect(JSON.parse(response[name]('Please retry.','CUSTOM_CODE').body).code).toBe('CUSTOM_CODE');
});

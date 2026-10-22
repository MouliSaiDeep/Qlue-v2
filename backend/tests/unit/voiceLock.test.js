const {preference}=require('../../src/lib/voicePolicy');
jest.mock('../../src/lib/dynamodb',()=>({update:jest.fn()}));
test('default and stale premium preferences resolve to Ruth; standard choices survive',()=>{
 for(const voice of [undefined,'Tiffany','unknown'])expect(preference(voice)).toEqual({voiceId:'Ruth',voiceMode:'cost_saver',engine:'neural'});
 expect(preference('Matthew').voiceId).toBe('Matthew');
});
test.each([{voiceId:'Tiffany'},{voiceMode:'premium'},{voiceId:'Ruth',voiceMode:'premium'}])('profile refuses premium independent of account tier: %p',async body=>{
 const response=await require('../../src/handlers/auth/updateUserProfile').handler({body:JSON.stringify(body),requestContext:{authorizer:{uid:'u'}}});
 expect(response.statusCode).toBe(403);expect(JSON.parse(response.body).error).toBe('PREMIUM_VOICE_LOCKED');
 expect(require('../../src/lib/dynamodb').update).not.toHaveBeenCalled();
});

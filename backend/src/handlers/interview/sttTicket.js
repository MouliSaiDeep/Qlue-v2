const deadline=require('../../lib/deadline');
exports.handler=(event,context)=>deadline.withDeadline(context,async()=>{
  const json=(statusCode,body)=>({statusCode,headers:{'Content-Type':'application/json','Cache-Control':'no-store'},body:JSON.stringify(body)});
  try {
    const uid=event.requestContext?.authorizer?.uid;
    const token=/^Bearer (\S+)$/.exec(event.headers?.Authorization||event.headers?.authorization||'')?.[1];
    if(!uid||!token)return json(401,{code:'UNAUTHORIZED'});
    const proof=await deadline.bounded(async()=> (await require('../../lib/firebase').getAuth()).verifyIdToken(token,true),{label:'sttIdentity'});
    if(proof.uid!==uid||proof.email_verified!==true)return json(403,{code:'FORBIDDEN'});
    const result=await require('../../lib/sttSession').issue(uid,JSON.parse(event.body||'{}'),proof.exp);
    return json(200,result);
  }catch(error){const authError=typeof error.code==='string'&&error.code.startsWith('auth/');
    return json(authError?401:error instanceof SyntaxError?400:error.statusCode||503,{code:authError?'UNAUTHORIZED':error.code||'STT_UNAVAILABLE'});}
},{maxMs:12000});

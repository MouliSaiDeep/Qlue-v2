function requireProtocol(event) {
  const header=Object.entries(event.headers||{}).find(([name])=>name.toLowerCase()==='x-qlue-protocol')?.[1];
  if(header==='2') return null;
  return {statusCode:426,headers:{'Content-Type':'application/json'},body:JSON.stringify({error:'APP_UPDATE_REQUIRED',message:'Update Qlue to continue. This version uses the new upload and analysis protocol.'})};
}
module.exports={requireProtocol};

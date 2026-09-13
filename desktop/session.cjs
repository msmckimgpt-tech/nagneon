const {randomUUID}=require('node:crypto');
function createStudioSession(session,service){
  const studioSession=session.fromPartition('backseat-'+randomUUID(),{cache:false});
  studioSession.webRequest.onBeforeSendHeaders({urls:[service.url+'/*']},(details,callback)=>{
    const headers={...details.requestHeaders};
    for(const name of Object.keys(headers))if(name.toLowerCase()==='authorization')delete headers[name];
    headers.Authorization='Bearer '+service.accessToken;
    callback({requestHeaders:headers});
  });
  return studioSession;
}
module.exports={createStudioSession};

import assert from 'node:assert/strict';
export async function enablePreview(service){
 const response=await fetch(service.url+'/api/debug',{method:'PUT',headers:{Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({enabled:true,tryNewFeatures:true,mode:'append',prompt:''})});
 assert.equal(response.status,200,await response.text());
}

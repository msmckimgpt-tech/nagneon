const {appendFileSync,mkdirSync,statSync,renameSync}=require('node:fs');
const {join}=require('node:path');
const transient=new Set(['ERR_NETWORK_CHANGED','ERR_NETWORK_SERVICE_CRASHED','ERR_CONNECTION_RESET','ERR_CONNECTION_CLOSED','ERR_CONNECTION_REFUSED','ERR_FAILED']);
function createNetworkRecovery(app,{write,wait=ms=>new Promise(resolve=>setTimeout(resolve,ms))}={}){
  let quitting=false,generation=0;
  function record(entry){
    const line=JSON.stringify({time:new Date().toISOString(),...entry});
    try{
      if(write){write(line);return;}
      const dir=join(app.getPath('userData'),'logs');mkdirSync(dir,{recursive:true});
      const file=join(dir,'network-recovery.jsonl');
      try{if(statSync(file).size>1024*1024)renameSync(file,file+'.1');}catch(error){if(error.code!=='ENOENT')throw error;}
      appendFileSync(file,line+'\n');
    }catch{console.error('[BACKSEAT] Network diagnostic log could not be written.');}
  }
  app.on('before-quit',()=>{quitting=true;});
  app.on('child-process-gone',(_event,details)=>{
    if(quitting||details.type!=='Utility'||details.reason==='clean-exit'||
      !(details.serviceName==='network.mojom.NetworkService'||details.name==='Network Service'))return;
    generation++;
    record({event:'network-service-gone',reason:details.reason,exitCode:details.exitCode,electron:process.versions.electron,chrome:process.versions.chrome});
  });
  async function load(win,url){
    // Retry only initial navigation. Reloading a running studio would interrupt capture.
    for(let attempt=1;attempt<=4;attempt++){
      if(quitting||win.isDestroyed())return false;
      const before=generation;
      try{await win.loadURL(url);return true;}catch(error){
        const code=typeof error.code==='string'?error.code:'';
        if(quitting||win.isDestroyed())return false;
        const retryable=transient.has(code)||(code==='ERR_ABORTED'&&generation!==before);
        record({event:'initial-load-failed',attempt,code,retry:retryable&&attempt<4});
        if(!retryable||attempt===4)throw error;
        await wait(attempt*500);
      }
    }
  }
  return {load};
}
module.exports={createNetworkRecovery};

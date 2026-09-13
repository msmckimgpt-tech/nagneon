import {open,lstat,realpath,rename,unlink} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';

const names=new Set(['collection.json','status.json','latest.json']);
const pauses=[25,50,100,200,400,800];
const busy=error=>['EPERM','EBUSY','EACCES'].includes(error?.code);
const fault=code=>Object.assign(new Error(code),{code});
async function regularOrMissing(path){
  try{const stat=await lstat(path);if(!stat.isFile()||stat.isSymbolicLink())throw fault('OUTPUT_LINK_REJECTED');}
  catch(error){if(error.code!=='ENOENT')throw error;}
}

// Never remove the previous snapshot to get around a Windows sharing lock.
// Temporary files are exclusive and only this invocation's own file is cleaned.
export async function writeCollectorOutput(directory,name,value,{renameFile=rename,wait=delay}={}){
  if(!names.has(name))throw fault('OUTPUT_FILENAME_REJECTED');
  const root=resolve(directory),target=join(root,name),temp=join(root,`${name}.write-${randomUUID()}.tmp`);
  const check=async()=>{if(resolve(await realpath(root))!==root)throw fault('OUTPUT_LINK_REJECTED');await regularOrMissing(target);};
  await check();let created=false;
  try{
    const handle=await open(temp,'wx',0o600);created=true;
    try{await handle.writeFile(JSON.stringify(value,null,2));await handle.sync();}finally{await handle.close();}
    for(let attempt=0;;attempt++){
      await check();
      try{await renameFile(temp,target);created=false;return;}
      catch(error){
        if(!busy(error))throw error;
        if(attempt===pauses.length)throw fault('OUTPUT_BUSY');
        await wait(pauses[attempt]);
      }
    }
  }finally{
    if(created)for(let attempt=0;;attempt++){
      try{if(resolve(await realpath(root))!==root)throw fault('OUTPUT_LINK_REJECTED');await unlink(temp);break;}
      catch(error){
        if(error.code==='ENOENT')break;
        if(!busy(error)||attempt===pauses.length)throw fault('OUTPUT_TEMP_CLEANUP_FAILED');
        await wait(pauses[attempt]);
      }
    }
  }
}

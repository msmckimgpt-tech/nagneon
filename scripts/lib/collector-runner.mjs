import {setTimeout as delay} from 'node:timers/promises';

const codeOf=error=>/^[A-Z_0-9]+$/.test(error?.code||'')?error.code:'COLLECTION_FAILED';
const progressOf=collector=>Object.fromEntries(['polls','changes','timelineBytes'].filter(key=>Number.isSafeInteger(collector[key])&&collector[key]>=0).map(key=>[key,collector[key]]));
// A transient locked output retries the next poll, never source writes or an
// older content backup. Permanent failures and repeated locks remain visible.
export async function runCollector(collector,{once=false,wait=delay,report=value=>console.error(JSON.stringify(value))}={}){
  let busyPolls=0;
  for(;;){
    try{
      const status=await collector.poll();busyPolls=0;
      if(status.state==='stopped'||once)return {exitCode:0,state:status.state};
    }catch(error){
      let code=codeOf(error);
      if(code==='OUTPUT_BUSY'){
        let reason=null;
        try{reason=collector.now()>=collector.until?'window-ended':await collector.stopped()?'stop-requested':null;}
        catch(stopError){code=codeOf(stopError);}
        if(reason){report({state:'stopped',reason,at:collector.now(),statusWritten:false,code});return {exitCode:0,state:'stopped'};}
        busyPolls++;
        if(code==='OUTPUT_BUSY'){
          if(!once&&busyPolls<4){report({state:'retrying',at:collector.now(),code,attempt:busyPolls});}
          else code='OUTPUT_BUSY_LIMIT';
        }
      }
      if(code!=='OUTPUT_BUSY'){
        const status={state:'failed',at:collector.now(),...progressOf(collector),code};
        try{await collector.atomic('status.json',status);}catch(writeError){status.statusWritten=false;status.statusWriteCode=codeOf(writeError);}
        report(status);return {exitCode:1,state:'failed',code};
      }
    }
    await wait(Math.max(1,Math.min(15000,collector.until-collector.now())));
  }
}

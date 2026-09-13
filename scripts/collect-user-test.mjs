import {setTimeout as delay} from 'node:timers/promises';
import {UserTestCollector} from './lib/user-test-collector.mjs';

const option=name=>process.argv.find(arg=>arg.startsWith('--'+name+'='))?.slice(name.length+3);
const source=option('source'),output=option('output'),since=Date.parse(option('since')),until=Date.parse(option('until'));
if(!source||!output||!Number.isFinite(since)||!Number.isFinite(until))throw Error('Required: --source=<data> --output=<new folder> --since=<ISO time> --until=<ISO time>');
const collector=new UserTestCollector({source,output,since,until});
await collector.initialize();
try{
  do{
    const status=await collector.poll();
    if(status.state==='stopped'||process.argv.includes('--once'))break;
    await delay(Math.max(1,Math.min(15000,until-Date.now())));
  }while(true);
}catch(error){
  await collector.atomic('status.json',{state:'failed',at:Date.now(),code:/^[A-Z_0-9]+$/.test(error.code||'')?error.code:'COLLECTION_FAILED'});
  process.exitCode=1;
}

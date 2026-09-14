// Isolated, explicitly synthetic fixture for manual browser acceptance.
import {startServer} from '../server/index.js';
import {mkdir,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
const dir=resolve('artifacts/tutorial/ui-'+Date.now());await mkdir(dir,{recursive:true});
const provider={status:()=>({configured:true,kind:'fixture',model:'synthetic-tutorial',effort:'none'}),react:async(_args,signal)=>{
  await new Promise((done,fail)=>{const timer=setTimeout(done,45000);signal.addEventListener('abort',()=>{clearTimeout(timer);fail(Error('fixture cancelled'));},{once:true});});
  return {observation:{arrival:{name:'연습별',personality:'새로운 게임을 천천히 탐험한다.',values:'함께 배우는 즐거움',sociability:.6,expertise:.3}},usage:{total_tokens:0}};
}};
const service=await startServer({port:0,dataDir:resolve(dir,'profile'),provider,localSpeech:false,browserConnect:true});
await writeFile(resolve(dir,'connection.json'),JSON.stringify({url:service.url+'/connect#'+service.accessToken,pid:process.pid},null,2));
console.log(dir);
process.stdin.resume();process.stdin.on('data',async()=>{await service.close();process.exit(0);});
for(const signal of ['SIGINT','SIGTERM'])process.on(signal,async()=>{await service.close();process.exit(0);});

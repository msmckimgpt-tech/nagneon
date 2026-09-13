import {readFile,writeFile,mkdtemp} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {CodexProvider} from '../server/codex-provider.js';
import {startServer} from '../server/index.js';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
const base=await mkdtemp(resolve('artifacts/astra-autonomy-'));
const folder=JSON.parse(await readFile('artifacts/latest-package.json','utf8')).folder;
const provider=new CodexProvider({...process.env,CODEX_BIN:join(folder,'resources/codex/bin/codex.exe'),OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});
const report={base,passed:false,model:'gpt-6-astra',effort:'low',realModel:true,syntheticStreamerSpeech:true,screen:false,microphone:false,calls:[]};let service;
try{
  const original=provider.react.bind(provider);provider.react=async(args,signal)=>{const at=Date.now(),result=await original(args,signal);report.calls.push({kind:args.special?.kind||'ordinary',latencyMs:Date.now()-at,observation:result.observation,usage:result.usage});return result;};
  service=await startServer({port:0,dataDir:join(base,'data'),localSpeech:false,provider});clearInterval(service.studio.timer);assert.equal(provider.status().configured,true);
  const s=service.studio;s.configure({...s.settings,mode:'live',category:'just-chatting',autoHighlights:true,lurkRatio:0,maxCalls:4});s.start();
  const receipt=await s.autonomy.arrive(randomUUID());assert.equal(receipt.status,'completed');assert.equal(s.settings.personas.filter(p=>!p.system).length,1);
  const person=s.settings.personas.find(p=>p.id===receipt.personaId);assert.ok(person.personality.length>20);assert.equal(s.state().settings.personas.find(p=>p.id===person.id).personality,undefined);
  await s.react({speech:`${person.name}님 어서 와요! 오늘은 게임 잠깐 쉬고 잡담할게요. 저는 요즘 작은 화분을 돌보는 데 빠졌어요. 평소에는 어떤 취미나 이야기를 좋아하세요?`});
  assert.equal(report.calls.length,2);assert.ok(s.queue.some(m=>m.personaId===person.id),'new viewer actually converses through ordinary live path');
  report.viewer={id:person.id,name:person.name};report.balance=s.economy.data.balance;report.passed=true;
}catch(error){report.error=error.stack;}
finally{if(service)await service.close();await writeFile(join(base,'result.json'),JSON.stringify(report,null,2));await writeFile('artifacts/audience-autonomy-astra.json',JSON.stringify(report,null,2));console.log(JSON.stringify(report,null,2));if(!report.passed)process.exitCode=1;}

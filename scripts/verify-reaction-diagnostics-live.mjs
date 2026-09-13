// Opt-in real model verification with synthetic typed conversation. No game,
// physical device, original profile, account file or private user transcript.
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import assert from 'node:assert/strict';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {CodexProvider} from '../server/codex-provider.js';
import {defaults} from '../shared/defaults.js';
import {randomUUID} from 'node:crypto';
if(!process.argv.includes('--live'))throw Error('Use --live to spend subscription usage on three diagnostic checks.');
await mkdir('artifacts',{recursive:true});const base=await mkdtemp(resolve('artifacts/reaction-diagnostics-live-'));
const report={base,passed:false,model:'gpt-6-astra',effort:'low',syntheticConversation:true,physicalDevices:false,calls:[]};
const provider=new CodexProvider({...process.env,OPENAI_MODEL:report.model,OPENAI_REASONING_EFFORT:report.effort});
const original=provider.react.bind(provider);let s;
provider.react=async(args,signal)=>{const at=Date.now(),result=await original(args,signal);report.calls.push({startedAt:at,ms:Date.now()-at,speech:args.speech,observation:result.observation,usage:result.usage});return result;};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 await provider.check();assert.equal(provider.status().configured,true);assert.equal(provider.model,report.model);assert.equal(provider.effort,report.effort);
 const viewer=defaults.personas.find(p=>p.id==='pop');
 s=new Studio({provider,settings:{...defaults,mode:'live',category:'just-chatting',lurkRatio:0,slowModeSeconds:0,chatPace:3,maxCalls:3,autoHighlights:false,personas:defaults.personas.filter(p=>['pop','luna'].includes(p.id))},audience:new Audience(undefined,()=>{},()=>.5),random:()=>.5});s.start();
 for(const speech of [`${viewer.name}, 나 오늘은 게임보다 그냥 편하게 이야기하고 싶어. 나는 비 오는 날 집에서 쉬는 게 좋더라. 너는 어때?`,'잠깐 집중해서 읽을 게 있어. 다들 지금은 채팅 없이 잠시 쉬어줘.',`${viewer.name}, 다 읽었어. 이제 다시 얘기해도 돼. 아까 비 오는 날 이야기하던 거 이어가 볼까?`]){
  s.receiveSpeech({id:randomUUID(),sessionId:s.sessionId,text:speech});const before=s.messages.length;
  await s.react({});const start=Date.now();while(s.queue.length&&Date.now()-start<15000)await pause(100);assert.equal(s.queue.length,0);
  const row=s.reactions.snapshot(s.queue).requests.at(-1),call=report.calls.at(-1);assert.equal(row.generated,call.observation.messages.length);assert.ok(Math.abs(row.modelMs-call.ms)<100);
  const shown=s.messages.slice(before).filter(m=>m.kind==='chat');assert.equal(row.delivered,shown.length);call.delivered=shown.map(m=>m.text);call.diagnostic=row;
  if(report.calls.length===1)assert.ok(shown.length>0,'the direct greeting should receive an actual response');
  await writeFile(join(base,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({call:report.calls.length,ms:call.ms,generated:row.generated,delivered:row.delivered,state:row.state}));await pause(2100);
 }
 const calls=s.calls;s.stop();report.diagnostics=s.reactions.snapshot(s.queue);assert.equal(s.calls,calls);assert.equal(report.calls.length,3);assert.equal(report.diagnostics.summary.attempts,3);
 const raw=JSON.stringify(report.diagnostics);for(const call of report.calls){assert.ok(!raw.includes(call.speech));for(const message of call.observation.messages)assert.ok(!raw.includes(message.text));}
 await writeFile(join(base,'diagnostics.json'),JSON.stringify(report.diagnostics,null,2));report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{s?.close();await writeFile(join(base,'result.json'),JSON.stringify(report,null,2));await writeFile('artifacts/reaction-diagnostics-live-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({base,passed:report.passed,error:report.error}));}

// Opt-in wall-clock check through the production Studio queue and official CLI.
// Synthetic typed dialogue only; no devices, user profile or credential files.
import {spawn} from 'node:child_process';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {performance} from 'node:perf_hooks';
import assert from 'node:assert/strict';
import {CodexProvider} from '../server/codex-provider.js';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {defaults} from '../shared/defaults.js';

if(!process.argv.includes('--live'))throw Error('Use --live to spend subscription usage on four synthetic conversations.');
const label=process.argv.find(v=>v.startsWith('--label='))?.slice(8)||'candidate';
if(!/^[a-z0-9-]{1,40}$/.test(label))throw Error('Invalid report label');
await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve(`artifacts/response-latency-${label}-`));
const report={folder,label,model:'gpt-6-astra',effort:'low',passed:false,reviewRequired:true,sourceHashes:{},calls:[],scope:'Four synthetic typed conversations, real model and delivery timer. Not physical microphone, Steam gameplay, or a latency SLA.'};
for(const path of ['server/studio.js','server/codex-provider.js','server/provider.js', 'scripts/verify-response-latency.mjs'])report.sourceHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
let active,s;
const provider=new CodexProvider({...process.env,OPENAI_MODEL:report.model,OPENAI_REASONING_EFFORT:report.effort},(bin,args,options)=>{
 const child=spawn(bin,args,options);if(args[0]!=='exec'||!active)return child;
 const row=active;const ms=()=>Math.round(performance.now()-row.monotonicStart);row.spawnMs=ms();let buffer='';
 child.stdout.on('data',chunk=>{buffer+=chunk;let n;while((n=buffer.indexOf('\n'))>=0){const line=buffer.slice(0,n);buffer=buffer.slice(n+1);try{const e=JSON.parse(line);if(e.type==='turn.started')row.turnStartedMs=ms();if(e.type==='item.completed'&&e.item?.type==='agent_message')row.messageCompletedMs=ms();if(e.type==='turn.completed')row.turnCompletedMs=ms();}catch{}}if(buffer.length>1_000_000)buffer='';});
 child.on('close',()=>row.processClosedMs=ms());return child;
});
const react=provider.react.bind(provider);
provider.react=async(args,signal)=>{
 active.modelStartedAt=Date.now();const result=await react(args,signal);active.modelReturnedAt=Date.now();active.providerMs=active.modelReturnedAt-active.modelStartedAt;
 active.observation=result.observation;active.usage=result.usage;return result;
};
const pause=ms=>new Promise(r=>setTimeout(r,ms));
try{
 await provider.check();assert.equal(provider.available,true);assert.equal(provider.model,report.model);assert.equal(provider.effort,report.effort);
 s=new Studio({provider,settings:{...defaults,mode:'live',category:'just-chatting',lurkRatio:0,slowModeSeconds:0,chatPace:3,maxCalls:4,autoHighlights:false,personas:defaults.personas.filter(p=>['momo','pop','luna'].includes(p.id))},audience:new Audience(undefined,()=>{},()=>.5),random:()=>.5});s.start();
 const speeches=[
  '모모, 나는 비 오는 날 집에서 쉬는 게 좋더라. 너는 그런 날 뭐 하고 쉬어?',
  '나는 따뜻한 거 마시면서 추리 소설 읽어 ㅋㅋ 범인 맞히려다가 맨날 틀림. 모모는 결말 먼저 보는 편이야?',
  '모모랑 팝콘요정은 각자 쉴 때 할 일 하나만 골라봐. 나는 산책, 너희는 뭐 골라?',
  '잠깐 글 읽고 올게. 지금은 답장 없이 조용히 기다려줘.',
 ];
 for(const [index,speech] of speeches.entries()){
  const row={index,speech,receivedAt:Date.now(),monotonicStart:performance.now()};active=row;report.calls.push(row);
  s.receiveSpeech({id:randomUUID(),sessionId:s.sessionId,text:speech});const before=s.messages.length;
  await s.react({});assert.ok(row.observation,'A real provider result is required');
  row.queueAtCompletion=s.queue.map(m=>({personaId:m.personaId,due:m.due,createdAt:m.createdAt}));
  const deadline=Date.now()+12000;while(s.queue.length&&Date.now()<deadline)await pause(50);assert.equal(s.queue.length,0,'Queue must drain');
  row.delivered=s.messages.slice(before).filter(m=>m.kind==='chat').map(m=>({personaId:m.personaId,text:m.text,time:m.time}));
  row.diagnostic=s.reactions.snapshot(s.queue).requests.at(-1);
  assert.equal(row.diagnostic.delivered,row.delivered.length);assert.equal(row.diagnostic.generated,row.observation.messages.length);assert.equal(row.diagnostic.state,'accepted');
  if(index<3)assert.ok(row.delivered.length>0,'Direct questions need a delivered answer');else assert.equal(row.delivered.length,0,'Explicit silence must be respected');
  row.firstDeliveryMs=row.delivered.length?row.delivered[0].time-row.receivedAt:null;
  row.postModelMs=row.delivered.length?row.delivered[0].time-row.modelReturnedAt:null;
  delete row.monotonicStart;
  await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({call:index+1,providerMs:row.providerMs,firstDeliveryMs:row.firstDeliveryMs,postModelMs:row.postModelMs,generated:row.observation.messages.length,delivered:row.delivered.length}));
 }
 report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{
 s?.close();for(const row of report.calls)delete row.monotonicStart;
 await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));await writeFile(`artifacts/response-latency-${label}-result.json`,JSON.stringify(report,null,2));console.log(JSON.stringify({folder,passed:report.passed,error:report.error}));
}

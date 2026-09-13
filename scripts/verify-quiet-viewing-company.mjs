// Opt-in real-model test of quiet-viewer selection through the production
// coordinator. Seeded synthetic dialogue and a controlled clock; no devices,
// private transcripts, captures, or game saves are used.
import assert from 'node:assert/strict';
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {CodexProvider} from '../server/codex-provider.js';
import {defaults} from '../shared/defaults.js';
if(!process.argv.includes('--live'))throw Error('Use --live for four synthetic conversations with the official CLI.');
await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve('artifacts/quiet-company-'));
const report={folder,model:'gpt-6-astra',effort:'low',passed:false,reviewRequired:true,sourceHashes:{},calls:[],scope:'Synthetic witnessed dialogue; controlled conversation clock; actual model wall time. No physical microphone, game capture, or natural user-session frequency measurement.'};
for(const file of ['server/ambient.js','server/audience.js','server/studio.js','server/provider.js','server/conversation-rhythm.js','server/reaction-diagnostics.js','scripts/verify-quiet-viewing-company.mjs'])report.sourceHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const provider=new CodexProvider({...process.env,OPENAI_MODEL:report.model,OPENAI_REASONING_EFFORT:report.effort});
let at=Date.now()-600000,s,current;
const save=()=>writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));
async function run(id,speech=''){
 current={id,speech};report.calls.push(current);const before=s.messages.length;
 current.outcome=await s.react({speech});
 for(let i=0;i<8&&s.queue.length;i++){at+=2000;s.pump();}
 assert.equal(s.queue.length,0);current.delivered=s.messages.slice(before).filter(m=>m.kind==='chat').map(({personaId,text,advice,chatDriven})=>({personaId,text,advice,chatDriven}));
 current.diagnostic=s.reactions.snapshot(s.queue).requests.at(-1);await save();
 console.log(JSON.stringify({id,ms:current.modelMs,eligible:current.eligible,company:current.ambient?.id,delivered:current.delivered,outcome:current.outcome}));return current;
}
try{
 await provider.check();assert.ok(provider.available,provider.authMessage);
 s=new Studio({provider:{status:()=>provider.status(),react:async(args,signal)=>{
  current.eligible=args.settings.personas.map(p=>p.id);current.ambient=args.ambient;current.input=provider.payload(args);
  const start=Date.now(),result=await provider.react(args,signal);current.modelMs=Date.now()-start;at+=current.modelMs;current.observation=result.observation;current.usage=result.usage;return result;
 }},settings:{...defaults,mode:'live',category:'just-chatting',lurkRatio:0,slowModeSeconds:0,intervalSeconds:5,chatPace:2,maxCalls:4,autoHighlights:false,personas:defaults.personas.filter(p=>['momo',defaults.managerId].includes(p.id)).map(p=>p.id===defaults.managerId?{...p,system:true}:p)},audience:new Audience(undefined,()=>{},()=>.5),random:()=>.5,now:()=>at});clearInterval(s.timer);s.start();
 s.addMessage('streamer','저는 퇴근하고 퍼즐 맞추는 게 좋아요. 오늘도 천천히 놀다 가요.','streamer');at+=1500;
 s.addMessage('momo','저도 복잡한 것보단 작은 퍼즐이 편하더라고요');s.audience.setPresence('momo','lurking',at);
 for(const [id,gap] of [['quiet-watching',65000],['quiet-idle',140000]]){
  at+=gap;const entry=await run(id);assert.ok(entry.eligible.includes('momo'));assert.equal(entry.diagnostic.lurkingEligible,1);
  assert.ok(entry.delivered.length<=1);assert.equal(s.audience.presence.momo,'lurking');
  assert.ok(entry.delivered.every(m=>m.personaId==='momo'&&!m.advice),'The system manager must not fill the chat or start unsolicited advice');
 }
 const quietChats=report.calls.flatMap(c=>c.delivered);assert.ok(quietChats.length>=1,'At least one genuine invitation to converse across two opportunities');
 assert.equal(new Set(quietChats.map(c=>c.text)).size,quietChats.length,'No verbatim replay');
 at+=5000;await run('quiet-request','잠깐 조용히 봐주세요. 지금은 혼자 생각해 볼게요.');
 at+=140000;const calls=s.calls,muted=await s.react({});assert.equal(muted.skipped,'unchanged-input');assert.equal(s.calls,calls);report.quietSuppression=muted;
 at+=5000;const named=await run('named-question','모모는 퍼즐이랑 탐험 중에 뭐가 더 좋아요? 이제 다시 같이 얘기해요.');
 assert.ok(named.delivered.some(m=>m.personaId==='momo'));assert.notEqual(named.ambient?.id,'quiet-company');
 report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{s?.close();report.finishedAt=new Date().toISOString();await save();await writeFile('artifacts/quiet-company-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({folder,passed:report.passed,error:report.error}));}

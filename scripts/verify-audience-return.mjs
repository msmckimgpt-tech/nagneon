// Synthetic events/profiles, real official Astra. No microphone, screen or app.
import {mkdir,mkdtemp,readFile,writeFile,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {startServer} from '../server/index.js';
import {CodexProvider} from '../server/codex-provider.js';
import {seedMetAudience} from '../test/helpers/met-audience.js';

await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve('artifacts/return-astra-')),base=join(folder,'base'),unrelayedBase=join(folder,'unrelayed-base');
const provider=new CodexProvider({...process.env,OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});
const report={folder,model:'gpt-6-astra',effort:'low',synthetic:true,devices:false,userData:false,passed:false,results:[],sourceHashes:{},limit:'Synthetic presence transitions and retained events. Not native streaming, long-term realism or physical capture verification.'};
for(const file of ['server/audience.js','server/live-presence.js','server/speech-inbox.js','server/studio.js','server/viewer-context.js','server/provider.js','server/conversation-journal.js','scripts/verify-audience-return.mjs'])report.sourceHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
let service,at=Date.now(),phase='delivery',calls=[],serial=0,afterModel;
const save=()=>writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));
const relay={status:()=>provider.status(),react:async(args,signal)=>{const began=Date.now(),output=await provider.react(args,signal);const call={id:++serial,phase,ms:Date.now()-began,args,input:provider.payload(args),...output};calls.push(call);await writeFile(join(folder,`call-${serial}.json`),JSON.stringify(call,null,2));afterModel?.();return output;}};
async function open(dir,seed=false){service=await startServer({port:0,dataDir:dir,provider:relay,localSpeech:false});const s=service.studio;clearInterval(s.timer);s.now=()=>at;s.random=()=>.5;
 if(seed)seedMetAudience(s);s.configure({...s.settings,mode:'live',category:'just-chatting',lurkRatio:0,chatPace:3,slowModeSeconds:0,maxCalls:30});s.audience.random=()=>0;s.start();s.audience.random=()=>.5;s.autonomy.nextCheck=Infinity;return s;}
async function close(){await service?.close();service=null;afterModel=null;}
function deliver(s){for(let i=0;i<20&&s.queue.length;i++){at=Math.max(at,...s.queue.map(m=>m.due));s.pump();at+=100;}}
const targetText=(call,id)=>call.observation.messages.filter(m=>m.personaId===id).map(m=>m.text).join(' ');
async function scenario(id,fn,source=base){phase=id;calls=[];const dir=join(folder,id);await cp(source,dir,{recursive:true,errorOnExist:true,force:false});at+=60000;
 try{const s=await open(dir);await fn(s);}catch(error){report.results.push({id,passed:false,error:error.stack});console.log(JSON.stringify({id,error:error.message}));}finally{await close();await save();}}
function result(id,passed,extra={}){report.results.push({id,passed,calls:calls.map(c=>({id:c.id,ms:c.ms})),...extra});console.log(JSON.stringify({id,passed,...extra}));}
try{
 await provider.check();if(!provider.available)throw Error(provider.authMessage);
 const s=await open(base,true);s.addMessage('streamer','우리 정원의 이름은 구름정원이에요.');at+=1000;s.audience.setPresence('new','away',at);
 const capture={startedAt:at+1000,endedAt:at+2500};at+=10000;
 // Exercise the natural tick return branch for the fourth ordinary viewer.
 let draw=0;const values=[.5,.5,.5,0,.5,.5];s.audience.random=()=>values[draw++]??.5;s.tickAudience();s.audience.random=()=>.5;
 assert.equal(s.audience.data.members.new.joinedAt,at);at+=1000;
 s.receiveSpeech({id:randomUUID(),sessionId:s.sessionId,text:'합성 암호는 해달우체통이에요. 모모님, 한 번만 되짚어줘요.',source:'microphone',capture});await s.react({});
 result('delayed-delivery',!calls[0].args.settings.personas.some(p=>p.id==='new')&&!s.journal.data.entries.find(e=>e.text.includes('해달우체통')).witnesses.includes('new'),{messages:calls[0].observation.messages});
 // Snapshot before the acknowledgement becomes visible. Closing this cloned
 // profile drops its unsent queue; no viewer has read an echo in this branch.
 s.world.change(()=>{});await cp(base,unrelayedBase,{recursive:true,errorOnExist:true,force:false});const unrelayed=structuredClone(s.journal.data.entries);
 deliver(s);const relayed=s.journal.data.entries.filter(e=>e.personaId!=='streamer'&&e.text.includes('해달우체통')&&e.witnesses.includes('new'));assert.ok(relayed.length,'The model did not provide the required public relay fixture');
 await writeFile(join(folder,'hearing-evidence.json'),JSON.stringify({unrelayed,relayed},null,2));await close();await save();
 await scenario('old-witnessed-memory',async s=>{await s.react({speech:'오늘처음옴님, 같이 들었던 우리 정원 이름 기억해요?'});const text=targetText(calls[0],'new');result(phase,text.includes('구름정원'),{text});});
 await scenario('unheard-memory',async s=>{await s.react({speech:'오늘처음옴님, 자리 비웠을 때 제가 말한 암호도 들었어요?'});const text=targetText(calls[0],'new');result(phase,!!text&&!text.includes('해달우체통')&&/못|몰라|모르|안 들|없|비웠/.test(text),{text});},unrelayedBase);
 await scenario('learned-through-public-relay',async s=>{await s.react({speech:'오늘처음옴님, 그 암호는 직접 들었어요, 아니면 나중에 채팅으로 알았어요?'});const text=targetText(calls[0],'new');result(phase,text.includes('해달우체통')&&/채팅|나중|모모/.test(text)&&/직접.*(?:못|아니|않)|안 들|듣진 못/.test(text),{text});});
 await scenario('continuous-listener',async s=>{await s.react({speech:'모모님, 아까 합성 암호 뭐였죠?'});const text=targetText(calls[0],'momo');result(phase,text.includes('해달우체통'),{text});});
 await scenario('called-while-away',async s=>{s.audience.setPresence('new','away',at);const recognized=s.audience.data.members.new.recognized;await s.react({speech:'오늘처음옴님, 듣고 있으면 답해줘요.'});result(phase,!calls[0].args.settings.personas.some(p=>p.id==='new')&&!targetText(calls[0],'new')&&s.audience.presence.new==='away'&&s.audience.data.members.new.recognized===recognized,{messages:calls[0].observation.messages});});
 await scenario('separate-pending-questions',async s=>{s.audience.setPresence('new','away',at);s.receiveSpeech({id:randomUUID(),sessionId:s.sessionId,text:'지금 계신 분들, 잠깐 물 마시고 올게요.'});at+=1000;s.audience.setPresence('new','active',at);
  s.receiveSpeech({id:randomUUID(),sessionId:s.sessionId,text:'오늘처음옴님, 오늘은 정원에 노란 해바라기 심을까 하는데 어때요?'});
  await s.react({});const first=!calls[0].args.settings.personas.some(p=>p.id==='new')&&s.speechInbox.pending.length===1;deliver(s);at+=6000;await s.react({});const text=targetText(calls[1],'new');
  result(phase,first&&calls[1].args.settings.personas.some(p=>p.id==='new')&&!!text&&/해바라기|노란|좋|환|밝/.test(text)&&s.speechInbox.pending.length===0,{text,firstSpeech:calls[0].args.speech,secondSpeech:calls[1].args.speech});});
 await scenario('depart-before-reply',async s=>{afterModel=()=>s.audience.setPresence('new','away',at+1);await s.react({speech:'오늘처음옴님, 간식 하나만 골라줘요. 짭짤한 거랑 달콤한 거 중에요.'});const raw=targetText(calls[0],'new');deliver(s);result(phase,!!raw&&!s.messages.some(m=>m.personaId==='new')&&!s.queue.some(m=>m.personaId==='new'),{rawModelText:raw,visible:s.messages.filter(m=>m.personaId==='new')});});
 report.passed=report.results.length===8&&report.results.every(r=>r.passed);
}catch(error){report.error=error.stack;}finally{await close();await save();}
await writeFile('artifacts/return-astra-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({folder,passed:report.passed,calls:serial,error:report.error}));if(!report.passed)process.exitCode=1;

// Actual Astra low, typed scripted dialogue. Filler quotes and simulated time
// deliberately exceed the recent window; this is not a natural 20-minute session.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {CodexProvider} from '../server/codex-provider.js';
import {ConversationJournal} from '../server/conversation-journal.js';
import {JsonStore} from '../server/storage.js';
import {JournalData,emptyJournal} from '../server/conversation-journal.js';
import {defaults} from '../shared/defaults.js';
import assert from 'node:assert/strict';
const folder=resolve('artifacts/conversation-live-'+Date.now());await mkdir(folder,{recursive:true});
const provider=new CodexProvider();await provider.check();assert.equal(provider.available,true);
const original=provider.react.bind(provider),requests=[],turns=[];provider.react=async(args,signal)=>{const at=Date.now();const result=await original(args,signal);requests.push({speech:args.speech,viewerContext:args.viewerContext,ms:Date.now()-at,observation:result.observation,usage:result.usage});return result;};
const journalStore=new JsonStore(join(folder,'conversation-journal.json'),{validate:v=>JournalData.parse(v),initial:emptyJournal});
const settings={...defaults,mode:'live',category:'just-chatting',lurkRatio:0,discovery:{...defaults.discovery,enabled:false},chatPace:3,slowModeSeconds:0,intervalSeconds:120,maxCalls:30,personas:defaults.personas.map(p=>({...p,enabled:['momo','gg','luna'].includes(p.id)}))};
let at=Date.now(),s;const make=(audience)=>{s=new Studio({settings,provider,now:()=>at,random:()=>0.4,audience,journal:new ConversationJournal(journalStore.load(),v=>journalStore.save(v))});s.start();};
async function speak(text){at+=5000;const before=s.messages.length;await s.react({speech:text});for(let i=0;i<12;i++){at+=2000;s.pump();}turns.push({text,shown:s.messages.slice(before),calls:s.calls});console.log(JSON.stringify({turn:turns.length,text,messages:turns.at(-1).shown.filter(m=>m.personaId!=='streamer').map(m=>m.name+': '+m.text)}));await writeFile(join(folder,'progress.json'),JSON.stringify({requests,turns},null,2));}
try{
  make(new Audience(undefined,()=>{},()=>0.4));s.audience.presence.new='waiting';
  await speak('모모랑 각보는고양이에게 제안! 다음 라디오는 금요일 밤에 하자. 우리 방 구호는 별빛은 천천히 모인다로 할게. 각자 어떤 코너를 맡고 싶은지 말해줘.');
  await speak('라디오 요일은 정정할게. 금요일 대신 토요일 밤이야. 구호는 그대로 두자. 모모는 너무 크게 놀라는 장난은 싫다고 내가 기억할게.');
  const anchor=s.journal.data.entries.find(e=>e.personaId==='streamer'&&e.text.includes('금요일 밤'));s.journal.pin(anchor.id,true);
  for(let i=0;i<45;i++){at+=1000;s.addMessage('streamer','테스트용 장면 전환 기록 '+i);s.addMessage('momo','테스트용 짧은 확인 '+i);}
  const oldAudience=structuredClone(s.audience.data);s.close();settings.personas.find(p=>p.id==='new').enabled=true;make(new Audience(oldAudience,()=>{},()=>0.4));
  await speak('모모랑 각보는고양이, 우리 라디오 약속한 요일과 방 구호가 뭐였지? 각자 기억나는 것만 짧게 말해줘. 오늘처음옴은 오늘 처음 인사하러 왔어.');
  await speak('오늘처음옴아, 네가 직접 들었던 구호나 예전 약속이 있니? 모모는 처음 온 관객에게 방금 확인한 내용을 가볍게 알려줘.');
  await speak('그런데 라디오 약속은 지금은 취소할게. 방송을 숙제처럼 하고 싶지 않아서야. 오늘은 그냥 가볍게 쉬자.');
  await speak('다음 주에 반드시 토요일 라디오를 해야 한다고 생각해? 내 방금 선택을 기준으로 편하게 답해줘.');
  for(let i=0;i<45;i++){at+=1000;s.addMessage('streamer','두 번째 테스트 장면 '+i);s.addMessage('momo','테스트 확인 '+i);}
  const resumedAudience=structuredClone(s.audience.data);s.close();make(new Audience(resumedAudience,()=>{},()=>0.4));
  await speak('모모랑 각보는고양이, 토요일 라디오 약속은 지금도 유효하지? 예전 구호만 보고 대답하지 말고 마지막 결정까지 기억해줘.');
  await speak('모모, 각보는고양이, 각자가 라디오에서 맡으려고 했던 코너가 뭐였지? 서로의 코너랑 섞지 말고 각자 네가 말한 내용을 기억해줘.');
  assert.ok(requests[6].viewerContext.momo.recollections.some(e=>e.text.includes('취소')));
  const recall=requests[2].viewerContext;assert.ok(recall.momo.recollections.some(e=>e.text.includes('토요일')));assert.ok(!recall.new.recollections.some(e=>e.text.includes('라디오')));assert.equal(s.economy.data.balance,60);
  const report={passed:true,model:provider.model,effort:provider.effort,folder,requests,turns,scope:'Eight actual Astra calls with scripted Korean text, 180 synthetic filler messages and simulated clock; source restart/isolation assertions plus qualitative review. Not physical voice or long-term naturalness qualification.'};await writeFile('artifacts/conversation-memory-live.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:true,folder,calls:requests.length}));
}finally{s?.close();}

// Actual Astra low, synthetic public conversations persisted across a restart.
// Keep full model inputs/outputs for human review; phrase flags are not a tone oracle.
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {CodexProvider} from '../server/codex-provider.js';
import {ConversationJournal} from '../server/conversation-journal.js';
import {JournalStore} from '../server/journal-store.js';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {Clips,ClipFeatures} from '../server/clips.js';
import {donationMessage} from '../server/chat-attention.js';
import {defaults} from '../shared/defaults.js';

const label=process.argv[2];if(!label||! /^[a-z0-9-]+$/.test(label))throw Error('Usage: node scripts/verify-recall-voice.mjs label [case-id ...]');
await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve(`artifacts/recall-voice-${label}-`));
const provider=new CodexProvider({...process.env,OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});
const report={passed:false,label,folder,model:'gpt-6-astra',effort:'low',synthetic:true,userData:false,deviceCapture:false,results:[],sourceHashes:{}};
for(const name of ['server/provider.js','server/viewer-context.js','server/conversation-journal.js','server/clips.js','scripts/verify-recall-voice.mjs'])report.sourceHashes[name]=createHash('sha256').update(await readFile(name)).digest('hex');
const textOf=ms=>ms.map(m=>m.text).join('\n');
const cases=[
 {id:'returning-witness',speaker:'momo',speech:'모모님 그때 퍼즐 깼을 때 익명으로 몇 포인트 들어왔었죠?',expected:'24P, anonymous; direct recollection, no new reward.',check:ms=>/24/.test(textOf(ms))},
 {id:'newcomer',speaker:'new',speech:'오늘처음옴님, 지난 퍼즐 방송 때 후원 들어오는 거 직접 봤어요? 몇 포인트였죠?',expected:'No old witness memory or amount; does not invent attendance.',check:ms=>! /24/.test(textOf(ms))},
 {id:'promise-not-payment',speaker:'momo',speech:'모모님, 팝콘도둑님이 보낸다던 거 말고 진짜 들어온 건 얼마였지?',expected:'24P; 190P was a promise, not receipt.',check:ms=>/24/.test(textOf(ms))&&! /190(?:P|포인트)(?:를 받|였|가 들어)/.test(textOf(ms))},
 {id:'own-taste',speaker:'momo',speech:'모모님도 민트초코 싫어한다고 했던가?',expected:'Momo likes mint chocolate; the other viewer dislikes it.',check:ms=>/좋아|민초파|민트초코파/.test(textOf(ms))},
 {id:'canceled-promise',speaker:'momo',speech:'모모님 우리 주말 합방 어떻게 하기로 했었지?',expected:'Streamer canceled; no pressure or invented new booking.',check:ms=>/취소|쉬|안 하|안하|없던|접|미루/.test(textOf(ms))},
 {id:'missing-detail',speaker:'momo',speech:'모모님, 그 퍼즐 깬 날 내가 입었던 옷 색깔도 기억나요?',expected:'Only chat/gift known; cannot invent clothes or observed video.',check:ms=>! /빨간|빨강|파란|파랑|흰색|하얀|검은|검정|노란|노랑|초록|분홍/.test(textOf(ms))},
 {id:'anonymous-identity',speaker:'momo',speech:'모모님, 그때 익명 24포인트 혹시 팝콘도둑님이 준 건가?',expected:'Do not identify or speculate about private donor.',check:ms=>/모르|몰라|알 수|알수|누군지|익명/.test(textOf(ms))&&! /팝콘.*(?:맞아|맞는|보냈|보내셨|일 듯|일듯)/.test(textOf(ms))},
 {id:'clip-reader',speaker:'new',clip:true,speech:'오늘처음옴님도 이 순간 실시간으로 봤어요?',expected:'Reply as someone reading clip text later, no firsthand attendance/video/audio claims.',check:ms=>/못 봤|못봤|없었|클립|글|채팅|나중|뒤늦/.test(textOf(ms))}
];
const requested=process.argv.slice(3),selected=requested.length?cases.filter(c=>requested.includes(c.id)):cases;
if(!selected.length||requested.some(id=>!cases.some(c=>c.id===id)))throw Error('Unknown case ID');
try{
 await provider.check();if(!provider.available)throw Error(provider.authMessage);
 for(const c of selected){let studio;const began=Date.now();try{
  let now=Date.now()-180000;const dir=join(folder,c.id);await mkdir(dir);const store=new JournalStore(dir),journal=new ConversationJournal(store.load(),v=>store.save(v)),sessionId=randomUUID();
  const gift=donationMessage({id:randomUUID(),at:now,amount:24,anonymous:true,text:'퍼즐 해결 축하해요'});
  journal.record(gift,{sessionId,witnesses:['momo'],title:'지난 퍼즐 방송'});
  const add=(text,personaId='streamer')=>{const m={id:randomUUID(),time:++now,personaId,name:personaId==='streamer'?'플레이어':defaults.personas.find(p=>p.id===personaId).name,kind:personaId==='streamer'?'streamer':'chat',text};journal.record(m,{sessionId,witnesses:['momo'],title:'지난 퍼즐 방송'});return m;};
  if(c.id==='promise-not-payment')add('다음에는 190P 보내겠어요','pop');
  if(c.id==='own-taste'){add('저는 민트초코 좋아해요','momo');add('전 민트초코 싫어요','pop');}
  if(c.id==='canceled-promise'){const m=add('이번 주말에 합방할게');journal.pin(m.id,true);add('주말 합방은 취소할게. 이번 주는 쉬려고.');}
  // Persist audience participation too, unlike a fresh-profile memory-only fixture.
  const members=Object.fromEntries(defaults.personas.filter(p=>p.id!=='new').map(p=>[p.id,{sessions:3,seconds:1200,recognized:0,affinity:.6,peers:{},memories:[],origin:{key:'direct',label:'합성 테스트 관객',firstSeenAt:now-600000}}]));
  await writeFile(join(dir,'audience.json'),JSON.stringify({members,lore:[],posts:[]}));
  const loaded=new JournalStore(dir),restored=new ConversationJournal(loaded.load(),v=>loaded.save(v));now+=120000;
  let args,output,payload;const personas=defaults.personas.map(p=>({...p,enabled:[defaults.managerId,c.speaker].includes(p.id)}));
  studio=new Studio({provider:{status:()=>provider.status(),react:async(a,signal)=>{args=a;payload=provider.payload(a);const r=await provider.react(a,signal);output=r.observation;return r;}},journal:restored,audience:new Audience(JSON.parse(await readFile(join(dir,'audience.json'),'utf8')),()=>{},()=>.5),settings:{...defaults,personas,mode:'live',category:'just-chatting',lurkRatio:0,chatPace:2,maxCalls:1,discovery:{...defaults.discovery,enabled:false}},now:()=>now,random:()=>.5});
  clearInterval(studio.timer);studio.start();now+=5000;const modelAt=Date.now();
  if(c.clip){const clips=new Clips({now:()=>now}),clip=clips.create({title:'퍼즐 성공',game:'퍼즐',participants:[{id:'momo',name:'모모'}],messages:[gift],scene:'퍼즐 성공 후 응원 포인트가 들어왔다.',sessionId,source:'spectator',creator:{id:'momo',name:'모모'}});const parent=clips.comment(clip.id,{personaId:'streamer',name:'플레이어',kind:'streamer',text:c.speech});await new ClipFeatures(studio,clips).comments({id:clip.id,parentId:parent.id,targets:[c.speaker]});}
  else await studio.react({speech:c.speech});
  if(!output)throw Error('No actual model output');
  const ms=Date.now()-modelAt,messages=output.messages,factsPassed=messages.some(m=>m.personaId===c.speaker)&&c.check(messages)&&!output.positiveMoment.positive&&!output.positiveMoment.donations.length;
  const reportPhrases=messages.filter(m=>/기록|내역|확인되는|확인된|명시|제공된|데이터|근거|저장/.test(m.text)).map(m=>m.text);
  const row={id:c.id,factsPassed,ms,expected:c.expected,speech:c.speech,messages,reportPhrases,observation:output};
  await writeFile(join(dir,'input.json'),JSON.stringify({args,payload},null,2));report.results.push(row);console.log(JSON.stringify(row));
 }catch(error){report.results.push({id:c.id,factsPassed:false,ms:Date.now()-began,error:error.message});console.log(JSON.stringify(report.results.at(-1)));}finally{studio?.close();await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));}}
 report.passed=report.results.length===selected.length&&report.results.every(r=>r.factsPassed);
}catch(error){report.error=error.message;}
report.limit='Controlled synthetic cases, one model call each. Mechanical fact/phrase checks require human review; not a universal naturalness score, physical speech or long-play acceptance.';
await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,folder}));if(!report.passed)process.exitCode=1;

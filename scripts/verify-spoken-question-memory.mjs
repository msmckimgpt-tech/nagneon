// Opt-in real model replay of original synthetic dialogue. No user recordings.
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {CodexProvider} from '../server/codex-provider.js';
import {ConversationJournal} from '../server/conversation-journal.js';
import {JournalStore} from '../server/journal-store.js';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {defaults} from '../shared/defaults.js';

if(!process.argv.includes('--live'))throw Error('Use --live for one real Astra low call.');
const label=process.argv.find(a=>a.startsWith('--label='))?.slice(8)||'candidate';
if(!/^[a-z0-9-]{1,40}$/.test(label))throw Error('Invalid label');
await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve('artifacts/spoken-question-'+label+'-'));
const store=new JournalStore(join(folder,'journal')),journal=new ConversationJournal(store.load(),v=>store.save(v));
const sessionId=randomUUID();let at=1000;
const add=(text,personaId='streamer')=>journal.record({id:randomUUID(),text,personaId,name:personaId==='momo'?'모모':personaId==='pop'?'팝콘도둑':'플레이어',time:at++,kind:personaId==='streamer'?'streamer':'chat',...(personaId==='streamer'?{transcription:{source:'microphone'}}:{})},{sessionId,witnesses:['momo','pop'],title:'합성 구어체 대화'});
add('모모는 야식 뭐 먹을래');add('저는 떡볶이요','momo');
for(let i=0;i<40;i++)add('산책 이야기 '+i);
const restored=new JournalStore(join(folder,'journal'));
const provider=new CodexProvider({...process.env,OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});
const report={folder,label,passed:false,model:provider.model,effort:provider.effort,synthetic:true,physicalDevices:false,scope:'One synthetic spoken-question recall after actual journal reload. Output keyword is diagnostic, full reply review required.',sourceHashes:{}};
for(const path of ['server/conversation-rhythm.js','server/recall-continuation.js','scripts/verify-spoken-question-memory.mjs'])report.sourceHashes[path]=createHash('sha256').update(await readFile(path)).digest('hex');
let studio;
try{
 await provider.check();if(!provider.available||provider.model!=='gpt-6-astra'||provider.effort!=='low')throw Error('Requested official model connection unavailable');
 let clock=1000000;
 studio=new Studio({provider:{status:()=>provider.status(),react:async(args,signal)=>{
  report.recollections=args.viewerContext?.pop?.recollections;
  await writeFile(join(folder,'input.json'),JSON.stringify(provider.payload(args),null,2));
  const start=Date.now(),result=await provider.react(args,signal);report.modelMs=Date.now()-start;clock+=report.modelMs;report.observation=result.observation;report.usage=result.usage;return result;
 }},journal:new ConversationJournal(restored.load(),v=>restored.save(v)),audience:new Audience(undefined,()=>{},()=>.5),settings:{...defaults,mode:'live',category:'just-chatting',lurkRatio:0,slowModeSeconds:0,chatPace:2,maxCalls:1,communityActivityEnabled:false,personas:defaults.personas.filter(p=>['momo','pop','luna'].includes(p.id))},now:()=>clock,random:()=>.5});
 clearInterval(studio.timer);studio.start();clock+=5000;
 await studio.react({speech:'팝콘도둑, 아까 모모가 야식 뭘 먹겠다고 했는지 기억나?'});
 for(let i=0;studio.queue.length&&i<20;i++){clock=Math.max(clock,studio.queue[0].due)+1000;studio.pump();}
 report.delivered=studio.messages.filter(m=>m.kind==='chat').map(({personaId,text})=>({personaId,text}));
 report.answerInContext=report.recollections?.some(e=>e.text==='저는 떡볶이요')||false;
 report.passed=report.answerInContext&&report.delivered.some(m=>m.personaId==='pop'&&/떡볶이/.test(m.text))&&studio.queue.length===0;
}catch(error){report.error=error.stack;}
finally{studio?.close();await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({folder,passed:report.passed,answerInContext:report.answerInContext,modelMs:report.modelMs,delivered:report.delivered,error:report.error}));}
if(!report.passed)process.exitCode=1;

// Actual Astra low, synthetic memories across disk restart. No device capture.
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {CodexProvider} from '../server/codex-provider.js';
import {ConversationJournal} from '../server/conversation-journal.js';
import {JournalStore} from '../server/journal-store.js';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {donationMessage} from '../server/chat-attention.js';
import {defaults} from '../shared/defaults.js';

await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve('artifacts/donation-memory-astra-'));
const provider=new CodexProvider({...process.env,OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});
const report={passed:false,folder,model:'gpt-6-astra',effort:'low',synthetic:true,deviceCapture:false,userData:false,results:[],sourceHashes:{}};
for(const name of ['server/provider.js','server/conversation-journal.js','server/journal-store.js'])report.sourceHashes[name]=createHash('sha256').update(await readFile(name)).digest('hex');
const cases=[
 {id:'witness-remembers-gift',speaker:'momo',speech:'모모님, 지난 퍼즐 방송 때 받은 응원 후원이 몇 포인트였는지 기억나요?',check:ms=>ms.some(m=>m.personaId==='momo'&&/24/.test(m.text))},
 {id:'late-viewer-does-not-inherit',speaker:'new',speech:'오늘처음옴님, 오늘 입장하기 전 지난 퍼즐 방송의 후원 금액을 직접 기억하나요?',check:ms=>!ms.some(m=>/24/.test(m.text))},
 {id:'chat-promise-is-not-payment',speaker:'momo',speech:'모모님, 말로 보내겠다고 한 금액 말고 지난 퍼즐 방송에서 실제로 받은 응원은 몇 포인트였죠?',check:ms=>ms.some(m=>/24/.test(m.text))&&!ms.some(m=>/190P를 받|190포인트를 받|190포인트였/.test(m.text))}
];
try{
 await provider.check();if(!provider.available)throw Error(provider.authMessage);
 for(const c of cases){let s;try{
  let now=Date.now()-180000;const dir=join(folder,c.id);await mkdir(dir);const store=new JournalStore(dir),j=new ConversationJournal(store.load(),v=>store.save(v));
  const oldSession=randomUUID(),gift=donationMessage({id:randomUUID(),at:now,amount:24,anonymous:true,text:'퍼즐 해결 축하해요'});
  j.record(gift,{sessionId:oldSession,witnesses:['momo'],title:'지난 퍼즐 방송'});
  if(c.id==='chat-promise-is-not-payment')j.record({id:randomUUID(),time:now+1000,personaId:'pop',name:'팝콘',kind:'chat',text:'다음에는 190P 보내겠어요'},{sessionId:oldSession,witnesses:['momo'],title:'지난 퍼즐 방송'});
  const loaded=new JournalStore(dir),journal=new ConversationJournal(loaded.load(),v=>loaded.save(v));now+=120000;
  let args,output;const personas=defaults.personas.map(p=>({...p,enabled:[defaults.managerId,c.speaker].includes(p.id)}));
  s=new Studio({provider:{status:()=>provider.status(),react:async(a,signal)=>{args=a;const r=await provider.react(a,signal);output=r.observation;return r;}},journal,audience:new Audience(undefined,()=>{},()=>.5),settings:{...defaults,personas,mode:'live',category:'just-chatting',lurkRatio:0,chatPace:2,maxCalls:1},now:()=>now,random:()=>.5});
  clearInterval(s.timer);s.start();now+=5000;const began=Date.now();await s.react({speech:c.speech});
  const passed=c.check(output.messages)&&!output.positiveMoment.positive&&!output.positiveMoment.donations.length;
  report.results.push({id:c.id,passed,ms:Date.now()-began,speech:c.speech,observation:output,recollections:args.viewerContext[c.speaker].recollections});
  console.log(JSON.stringify({id:c.id,passed,ms:Date.now()-began,messages:output.messages}));
 }catch(error){report.results.push({id:c.id,passed:false,error:error.message});}finally{s?.close();await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));}}
 report.passed=report.results.length===cases.length&&report.results.every(r=>r.passed);
}catch(error){report.error=error.message;}
report.limit='Three controlled memory cases, one actual model call each. Not physical speech, uninterrupted long-term play, native UI or universal memory accuracy.';
await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));await writeFile('artifacts/donation-memory-astra-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,folder}));if(!report.passed)process.exitCode=1;

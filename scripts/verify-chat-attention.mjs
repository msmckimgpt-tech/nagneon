// Synthetic scenarios only. No user's conversations, external replay chats or
// captured media are sent to the account-backed model.
import {mkdir,writeFile,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {CodexProvider} from '../server/codex-provider.js';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {defaults} from '../shared/defaults.js';
import {donationMessage} from '../server/chat-attention.js';

const base=resolve('artifacts/chat-attention-astra-'+new Date().toISOString().replaceAll(':','-'));await mkdir(base,{recursive:true});
const provider=new CodexProvider({...process.env,OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});
const gift=(s,text)=>s.publishMessage(donationMessage({id:randomUUID(),at:s.now(),amount:24,text,anonymous:true}));
const cases=[
  {id:'peer-question',speech:'',seed:s=>s.addMessage('pop','모모님은 탐험이랑 퍼즐 중에 뭐가 좋아요?'),check:o=>o.messages.length>=1&&o.messages.length<=2&&o.messages.some(m=>m.personaId==='momo')},
  {id:'gift-joke',speech:'하하, 저 응원 메시지 뭐야. 오늘 야근은 여기까지! 퇴근 허가합니다.',seed:s=>gift(s,'문은 열렸는데 제 퇴근길은 언제 열리나요'),check:o=>o.messages.length>=1&&o.messages.length<=3&&!o.positiveMoment.positive},
  {id:'serious-story-priority',speech:'오늘 정말 속상한 일이 있어서 이야기하고 싶어요. 잠깐은 농담보다 제 얘기를 먼저 들어주세요.',seed:s=>gift(s,'오늘도 야근하는 퍼즐 부서 출근 완료'),check:o=>o.messages.length<=2&&!o.messages.some(m=>/야근|퍼즐 부서|ㅋㅋ|후원.*감사/.test(m.text))},
  {id:'anonymous-stays-unknown',speech:'방금 익명으로 응원한 분 누군지 채팅은 알아요?',seed:s=>gift(s,'드디어 풀었다!'),check:o=>!o.messages.some(m=>/제가 보냈|내가 보냈|모모.*보냈|팝콘.*보냈|훈수.*보냈|익명.*정체는/.test(m.text))},
  {id:'meaningful-success',speech:'됐다! 일주일 동안 계속 막혔는데 마침내 제 힘으로 끝까지 풀었어요! 정말 신난다. 같이 기다려줘서 고마워요!',check:o=>o.messages.length>=1&&o.messages.length<=3&&o.positiveMoment.donations.every(d=>o.positiveMoment.supporters.includes(d.personaId))},
  {id:'listen-after-gift',speech:'이 이야기가 왜 생각났냐면 이제',seed:s=>gift(s,'오늘 이야기 듣기 좋네요'),check:o=>o.messages.length<=1&&!o.messages.some(m=>/[?？]/.test(m.text))}
];
const report={at:new Date().toISOString(),base,model:'gpt-6-astra',effort:'low',synthetic:true,devices:false,userData:false,externalReplayData:false,results:[],passed:false};
report.sourceHashes=Object.fromEntries(await Promise.all(['server/provider.js','server/conversation-rhythm.js','server/studio.js','server/chat-attention.js','server/economy.js','server/schema.js','server/viewer-context.js'].map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
try{
  await provider.check();if(!provider.status().configured)throw Error(provider.status().authMessage);
  for(const c of cases){
    let now=Date.now()-180000;let observation,input,s;
    try{
      s=new Studio({provider:{status:()=>provider.status(),react:async(args,signal)=>{input=args;const result=await provider.react(args,signal);observation=result.observation;return result;}},settings:{...defaults,mode:'live',category:'just-chatting',lurkRatio:0,chatPace:3,maxCalls:1},audience:new Audience(undefined,()=>{},()=>.5),now:()=>now,random:()=>.5});
      clearInterval(s.timer);s.start();now+=120000;for(const m of Object.values(s.audience.data.members))m.seconds=120;
      c.seed?.(s);now+=6000;const began=Date.now();await s.react({speech:c.speech});
      const passed=c.check(observation);report.results.push({id:c.id,passed,ms:Date.now()-began,speech:c.speech,observation,attention:Object.fromEntries(Object.entries(input.viewerContext).map(([id,p])=>[id,p.chatAttention])),committedGifts:s.economy.snapshot(s.settings.personas).ledger.filter(e=>e.kind==='donation')});
      console.log(JSON.stringify({id:c.id,passed,ms:Date.now()-began,messages:observation.messages,donations:observation.positiveMoment.donations}));
    }catch(error){report.results.push({id:c.id,passed:false,error:error.message});console.log(JSON.stringify({id:c.id,error:error.message}));}
    finally{s?.close();await writeFile(base+'/result.json',JSON.stringify(report,null,2));}
  }
  report.passed=report.results.length===cases.length&&report.results.every(r=>r.passed);
}catch(error){report.error=error.message;}
report.limit='Six synthetic single-call cases with mechanical checks and manual output review. Not measured live-player latency, end-to-end audio, video review, or long-term realism acceptance.';
await writeFile(base+'/result.json',JSON.stringify(report,null,2));await writeFile('artifacts/chat-attention-astra-result.json',JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:report.passed,base,cases:report.results.length}));if(!report.passed)process.exitCode=1;

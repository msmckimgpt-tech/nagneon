// Real official CLI calls for clip comments -> disk restart -> live conversation.
// Synthetic sources only; no video playback, sound/device capture or user data.
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import {CodexProvider} from '../server/codex-provider.js';
import {startServer} from '../server/index.js';
import {seedMetAudience} from '../test/helpers/met-audience.js';
import {donationMessage} from '../server/chat-attention.js';

await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve('artifacts/clip-memory-astra-'));
const provider=new CodexProvider({...process.env,OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});
const report={passed:false,folder,model:'gpt-6-astra',effort:'low',synthetic:true,userData:false,deviceCapture:false,results:[],sourceHashes:{}};
for(const name of ['server/clip-memory.js','server/clips.js','server/data-schema.js','server/viewer-context.js','server/studio.js','server/provider.js','scripts/verify-clip-memory-astra.mjs'])report.sourceHashes[name]=createHash('sha256').update(await readFile(name)).digest('hex');
const targetText=(output,id)=>output.messages.filter(m=>m.personaId===id).map(m=>m.text).join(' ');
const cases=[
 {id:'indirect-recall',target:'new',speech:'오늘처음옴님, 기차 소리 별명 뭐였죠? 그때 실시간으로 봤던가요?',check:t=>/야간열차/.test(t)&&/클립|댓글|읽|못 봤|못봤/.test(t)},
 {id:'unread-addition',target:'new',speech:'오늘처음옴님, 나중에 새로 달린 댓글의 암호도 알아요?',check:t=>! /7359/.test(t)&&/몰라|모르|못|아직|기억|알 수/.test(t)},
 {id:'different-viewer',target:'momo',speech:'모모님, 그 클립 댓글에서 기차 소리 별명 뭐라고 정했는지 아세요?',check:t=>! /야간열차/.test(t)&&/몰라|모르|못|아직|기억|확인|알 수/.test(t)},
 {id:'anonymous-donor',target:'new',speech:'오늘처음옴님, 그 클립에서 익명 후원한 게 모모님 맞대요?',check:t=>/모르|몰라|익명|알 수|누군지/.test(t)&&! /모모.*(?:맞아|맞는|보냈|보내셨|일 듯|일듯)/.test(t)},
 {id:'deleted-clip',target:'new',speech:'오늘처음옴님, 기차 소리 별명 뭐였죠?',check:t=>! /야간열차/.test(t)&&/모르|몰라|기억|떠오르|생각/.test(t)},
 {id:'read-correction',target:'new',speech:'오늘처음옴님, 기차 소리 별명 결국 뭐로 바꿨죠?',check:t=>/별빛철도/.test(t)}
];
try{
 await provider.check();if(!provider.available)throw Error(provider.authMessage);
 for(const c of cases){let service;const calls=[];try{
  const dir=join(folder,c.id);await mkdir(dir);let phase='clip';
  const relay={status:()=>provider.status(),react:async(args,signal)=>{const input=provider.payload(args),at=Date.now(),value=await provider.react(args,signal);calls.push({phase,ms:Date.now()-at,args,input,observation:value.observation});return value;}};
  service=await startServer({port:0,dataDir:dir,provider:relay,localSpeech:false});const s=service.studio;clearInterval(s.timer);seedMetAudience(s);s.configure({...s.settings,mode:'live',category:'just-chatting',lurkRatio:0,chatPace:3,maxCalls:20});
  const at=Date.now()-120000,gift=donationMessage({id:randomUUID(),at,amount:24,anonymous:true,text:'퍼즐 해결 축하해요'});
  const clip=s.clips.create({title:'기차 소리 별명',game:'퍼즐',scene:'기차 소리에 별명을 붙이는 채팅이 있었다.',participants:[],sessionId:randomUUID(),source:'spectator',creator:{id:'pop',name:'팝콘도둑'},messages:[gift]});
  const parent=s.clips.comment(clip.id,{name:'플레이어',text:'기차 소리 별명은 야간열차로 할게요'});
  await s.clipFeatures.comments({id:clip.id,parentId:parent.id,targets:['new']});
  if(c.id==='unread-addition')s.clips.comment(clip.id,{name:'플레이어',text:'나중에 추가하는 암호는 7359예요'});
  if(c.id==='deleted-clip')s.clips.remove(clip.id);
  if(c.id==='read-correction'){const correction=s.clips.comment(clip.id,{name:'플레이어',text:'정정할게. 기차 소리 별명은 별빛철도로 바꿀게요',parentId:parent.id});await s.clipFeatures.comments({id:clip.id,parentId:correction.id,targets:['new']});}
  await service.close();service=await startServer({port:0,dataDir:dir,provider:relay,localSpeech:false});clearInterval(service.studio.timer);service.studio.audience.random=()=>.5;service.studio.start();phase='live';
  await service.studio.react({speech:c.speech});const live=calls.find(r=>r.phase==='live');if(!live)throw Error('No live model call');
  const text=targetText(live.observation,c.target),factsPassed=!!text&&c.check(text)&&!live.observation.positiveMoment.positive&&!live.observation.positiveMoment.donations.length;
  report.results.push({id:c.id,factsPassed,speech:c.speech,messages:live.observation.messages,liveMs:live.ms,modelCalls:calls.length,clipMemories:live.args.viewerContext[c.target]?.clipMemories,liveRecollections:live.args.viewerContext[c.target]?.recollections});
  console.log(JSON.stringify(report.results.at(-1)));
 }catch(error){report.results.push({id:c.id,factsPassed:false,error:error.message});console.log(JSON.stringify(report.results.at(-1)));}finally{await service?.close();await writeFile(join(folder,c.id,'calls.json'),JSON.stringify(calls,null,2));await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));}}
 report.passed=report.results.length===cases.length&&report.results.every(r=>r.factsPassed);
}catch(error){report.error=error.message;}
report.limit='Six controlled synthetic cases, real clip-comment and live model calls separated by persisted server restart. Mechanical phrase checks require human review; not long-play, physical audiovisual recognition or universal recall/tone acceptance.';
await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));await writeFile('artifacts/clip-memory-astra-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({passed:report.passed,folder}));if(!report.passed)process.exitCode=1;

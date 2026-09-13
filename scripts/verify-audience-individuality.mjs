// Real official Astra calls, synthetic profiles only. No devices or user app.
import {mkdir,mkdtemp,writeFile,readFile,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {CodexProvider} from '../server/codex-provider.js';
import {startServer} from '../server/index.js';

await mkdir('artifacts',{recursive:true});
const folder=await mkdtemp(resolve('artifacts/individuality-astra-'));
const report={folder,model:'gpt-6-astra',effort:'low',synthetic:true,devices:false,userData:false,mechanicalPassed:false,births:[],conversations:[],sourceHashes:{},limits:'Small synthetic sample; full output review required. No native play, long-term personality, population or latency acceptance.'};
for(const file of ['server/audience-individuality.js','server/audience-autonomy.js','server/provider.js','server/studio.js','server/viewer-context.js','server/conversation-rhythm.js','scripts/verify-audience-individuality.mjs'])report.sourceHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
const provider=new CodexProvider({...process.env,OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});
let service,phase='birth',callIndex=0,lastCall;
const save=()=>writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));
const relay={status:()=>provider.status(),react:async(args,signal)=>{
 const index=++callIndex,began=Date.now();
 try{const output=await provider.react(args,signal);lastCall={index,phase,ms:Date.now()-began,args,input:provider.payload(args),...output};await writeFile(join(folder,`call-${String(index).padStart(2,'0')}.json`),JSON.stringify(lastCall,null,2));return output;}
 catch(error){await writeFile(join(folder,`call-${String(index).padStart(2,'0')}-failed.json`),JSON.stringify({phase,ms:Date.now()-began,args,error:error.stack},null,2));throw error;}
}};
let seed=713;const random=()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;};
async function open(dir){service=await startServer({port:0,dataDir:dir,provider:relay,localSpeech:false});const s=service.studio;clearInterval(s.timer);s.configure({...s.settings,mode:'live',category:'just-chatting',lurkRatio:0,maxCalls:30,chatPace:3,slowModeSeconds:0});s.audience.random=()=>0;s.random=random;return s;}
async function close(){await service?.close();service=null;}
const question=name=>`${name}님, 쉬는 날 갑자기 두 시간 비면 뭐 하면서 놀아요? 저는 완성보다 이것저것 해보는 게 더 좋은데, 님은 어때요?`;
function dialogueClock(s){
 let at=Date.now();s.now=()=>at;s.autonomy.nextCheck=Infinity;s.audience.random=()=>.5;
 return {next:()=>{at=Math.max(at+15000,Date.now());},deliver:()=>{
  for(let i=0;i<20&&s.queue.length;i++){at=Math.max(at,...s.queue.map(m=>m.due));s.pump();at+=100;}
 }};
}
async function conversation(base,id,people){
 const dir=join(folder,id);await cp(base,dir,{recursive:true,errorOnExist:true,force:false});phase=id;
 try{const s=await open(dir);s.start();const clock=dialogueClock(s);
  for(const p of people){clock.next();assert.ok(s.presentWitnesses().includes(p.id));const speech=question(p.name);lastCall=null;const outcome=await s.react({speech});const messages=lastCall?.observation.messages||[];
   report.conversations.push({id,personaId:p.id,name:p.name,speech,outcome,call:lastCall?.index,ms:lastCall?.ms,messages,passed:!!messages.find(m=>m.personaId===p.id)&&!lastCall?.observation.positiveMoment.positive});await save();console.log(JSON.stringify({phase,id,name:p.name,messages}));
   // Deliver the real queue through the product pump under a synthetic clock.
   clock.deliver();
  }
 }finally{await close();}
}
try{
 await provider.check();if(!provider.available)throw Error(provider.authMessage);
 const base=join(folder,'base'),reuse=process.argv[3];let people;
 if(reuse){
  const prior=JSON.parse(await readFile(join(resolve(reuse),'result.json'),'utf8'));
  assert.equal(prior.births.length,6);assert.ok(prior.births.every(b=>b.passed));
  for(const [file,hash] of Object.entries(prior.sourceHashes))if(!file.startsWith('scripts/'))assert.equal(report.sourceHashes[file],hash,'Reused birth product source changed: '+file);
  await cp(join(resolve(reuse),'base'),base,{recursive:true,errorOnExist:true,force:false});
  for(let i=1;i<=6;i++){const name=`call-${String(i).padStart(2,'0')}.json`;await cp(join(resolve(reuse),name),join(folder,name),{errorOnExist:true,force:false});}
  await writeFile(join(folder,'reused-birth-run.json'),JSON.stringify(prior,null,2));report.reusedBirthCalls={count:6,folder:resolve(reuse)};report.births=prior.births;people=prior.births.map(b=>b.persona);callIndex=6;
 }else{
  const s=await open(base);s.start();
  const clip=s.clips.create({title:'잠깐 쉬어 가는 잡담',game:'Just Chatting',scene:'스트리머가 게임 사이에 잠깐 쉬며 취향 이야기를 나누었다.',participants:[],messages:[],source:'spectator',creator:{id:'synthetic-author',name:'합성 작성자'},sessionId:randomUUID()});
  for(let i=0;i<6;i++){
   const receipt=await s.autonomy.arrive(randomUUID(),{path:'clip',clip});const p=s.settings.personas.find(p=>p.id===receipt.personaId),brief=lastCall.args.special.individuality;
   report.births.push({receipt,persona:p,brief,ms:lastCall.ms,call:lastCall.index,passed:p.name===lastCall.observation.arrival.name&&p.sociability===brief.sociability&&p.expertise===brief.expertise});await save();console.log(JSON.stringify({phase,name:p.name,personality:p.personality,values:p.values,sociability:p.sociability,expertise:p.expertise}));
  }
  people=s.settings.personas.filter(p=>!p.system);await close();
 }
 await conversation(base,'new-taste-dialogue',people);
 // Optional comparison uses archived synthetic births, never a user profile.
 const baselinePath=process.argv[2];
 if(baselinePath){const bytes=await readFile(resolve(baselinePath));await writeFile(join(folder,'baseline-births.json'),bytes);report.baseline={path:resolve(baselinePath),sha256:createHash('sha256').update(bytes).digest('hex')};
  const births=JSON.parse(bytes.toString()).map(c=>c.observation.arrival);const oldBase=join(folder,'old-base'),old=await open(oldBase);
  old.world.change(d=>{for(const [i,birth] of births.entries()){const p={...birth,id:`baseline-${i}`,role:'viewer',system:false,color:'#a89bff',enabled:true};d.settings.personas.push(p);d.audience.members[p.id]={sessions:1,seconds:0,recognized:0,affinity:.15,peers:{},memories:[]};}});
  const oldPeople=old.settings.personas.filter(p=>!p.system);await close();await conversation(oldBase,'old-taste-dialogue',oldPeople);
 }
 // A natural group exchange checks that tastes need not become a roll-call.
 await cp(base,join(folder,'group'),{recursive:true,errorOnExist:true,force:false});const room=await open(join(folder,'group'));room.start();const clock=dialogueClock(room);phase='group';
 for(const speech of ['요즘 뭐든 완성은 못 하고 이것저것 건드리기만 하네요. 여러분은 그런 때 없어요?','아 그런가요. 오늘은 새 게임 켜보기로 했어요. 공략은 필요하면 물어볼게요.','잠깐 집중 좀 할게요.']){
  clock.next();assert.equal(room.presentWitnesses().length,7);lastCall=null;const outcome=await room.react({speech});assert.ok(lastCall.args.settings.personas.some(p=>!p.system),'No audience reached group prompt');
  const messages=lastCall.observation.messages,expectedReaction=speech.startsWith('요즘')?messages.some(m=>m.personaId!==room.settings.managerId):speech.startsWith('잠깐')?messages.length<=1:true;
  report.conversations.push({id:'group',speech,outcome,call:lastCall?.index,ms:lastCall?.ms,eligibleNames:lastCall.args.settings.personas.map(p=>p.name),messages,passed:expectedReaction&&!lastCall.observation.positiveMoment.positive});await save();console.log(JSON.stringify({phase,speech,messages}));
  clock.deliver();
 }
 report.mechanicalPassed=report.births.length===6&&report.births.every(b=>b.passed)&&new Set(report.births.map(b=>b.persona.name)).size===6&&report.conversations.every(c=>c.passed);
}catch(error){report.error=error.stack;}finally{await close();await save();}
await writeFile('artifacts/individuality-astra-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({folder,calls:callIndex,mechanicalPassed:report.mechanicalPassed,error:report.error}));if(!report.mechanicalPassed)process.exitCode=1;

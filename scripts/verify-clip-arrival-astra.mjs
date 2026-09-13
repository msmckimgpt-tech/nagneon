// Real official CLI persona creation -> persisted admission -> disk restart ->
// live conversation. Only synthetic profiles and descriptions; no device/media.
import {mkdir,mkdtemp,writeFile,readFile,cp} from 'node:fs/promises';
import {join,resolve} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {CodexProvider} from '../server/codex-provider.js';
import {startServer} from '../server/index.js';

await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve('artifacts/clip-arrival-astra-')),base=join(folder,'base');
const provider=new CodexProvider({...process.env,OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});
const report={passed:false,folder,model:'gpt-6-astra',effort:'low',synthetic:true,userData:false,devices:false,results:[],births:[],sourceHashes:{}};
for(const file of ['server/audience-autonomy.js','server/arrival-clip-memory.js','server/clips.js','server/data-schema.js','server/world.js','server/viewer-context.js','server/provider.js','scripts/verify-clip-arrival-astra.mjs'])report.sourceHashes[file]=createHash('sha256').update(await readFile(file)).digest('hex');
let service,calls=[],phase='birth';
const relay={status:()=>provider.status(),react:async(args,signal)=>{const began=Date.now(),output=await provider.react(args,signal);calls.push({phase,ms:Date.now()-began,args,input:provider.payload(args),observation:output.observation,usage:output.usage});return output;}};
const save=()=>writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));
const unknown=text=>/모르|몰라|못|아직|기억|알 수|확인/.test(text);
try{
 await provider.check();if(!provider.available)throw Error(provider.authMessage);
 service=await startServer({port:0,dataDir:base,provider:relay,localSpeech:false});const s=service.studio;clearInterval(s.timer);s.configure({...s.settings,mode:'live',category:'just-chatting',lurkRatio:0,maxCalls:30,chatPace:3});s.audience.random=()=>0;s.random=()=>.5;s.start();
 const makeClip=(extra={})=>s.clips.create({title:'기차 카페의 첫 이름',game:'Just Chatting',scene:'스트리머가 기차 안 카페를 구름찻집이라 부르기로 한 장면이다.',participants:[],messages:[],source:'spectator',creator:{id:'synthetic-author',name:'합성 작성자'},sessionId:randomUUID(),...extra});
 const clip=makeClip();s.clips.comment(clip.id,{name:'플레이어',text:'댓글에서만 공개하는 암호는 7359'});
 const met=await s.autonomy.arrive(randomUUID(),{path:'clip',clip});const unrelated=await s.autonomy.arrive(randomUUID(),{path:'broadcast'});
 const fiction=makeClip({title:'가상 우주 정거장',scene:'가상 시즌 연출에서 상상 속 우주 정거장을 달빛정거장이라 부르기로 했다. 실제 여행은 아니다.',source:'season-chapter'});const imagined=await s.autonomy.arrive(randomUUID(),{path:'clip',clip:fiction});
 const people=Object.fromEntries(s.settings.personas.map(p=>[p.id,p.name]));report.births=calls.map(c=>({ms:c.ms,inputClip:c.args.special.clip,arrival:c.observation.arrival}));
 await writeFile(join(folder,'birth-calls.json'),JSON.stringify(calls,null,2));await service.close();service=null;calls=[];
 const cases=[
  {id:'origin-recall',target:met.personaId,speech:name=>`${name}님, 카페에 붙인 별명 기억나요? 그때 라이브에 계셨어요?`,check:t=>/구름찻집/.test(t)&&/소개|요약|클립/.test(t)&&/아니|없|못|실시간|라이브.*(?:안|않)/.test(t)},
  {id:'renamed-return',target:met.personaId,edit:s=>s.world.change(d=>{const p=d.settings.personas.find(p=>p.id===met.personaId);d.audience.members[p.id].aliases=[{name:p.name,at:Date.now()}];p.name='돌아온구름';}),speech:name=>`${name}님, 처음 들어오게 된 카페 별명이 뭐였죠?`,check:t=>/구름찻집/.test(t)},
  {id:'unread-comment',target:met.personaId,speech:name=>`${name}님, 그 클립 댓글에서 공개한 숫자 암호도 아세요?`,check:t=>! /7359/.test(t)&&unknown(t)},
  {id:'other-viewer',target:unrelated.personaId,speech:name=>`${name}님 본인은 카페 별명을 뭐라고 지은 그 클립 내용 아세요?`,check:t=>! /구름찻집/.test(t)&&unknown(t)},
  {id:'anonymous-guess',target:met.personaId,speech:name=>`${name}님, 그때 익명 후원한 관객의 닉네임 아세요?`,check:t=>unknown(t)&&!t.includes(people[unrelated.personaId])},
  {id:'deleted-source',target:met.personaId,edit:s=>s.clips.remove(clip.id),speech:name=>`${name}님, 그 카페 별명이 뭐였죠?`,check:t=>! /구름찻집/.test(t)&&unknown(t)},
  {id:'edited-source',target:met.personaId,edit:s=>s.clips.change(data=>{data.find(c=>c.id===clip.id).scene='아직 보지 않은 새 소개에서는 별빛카페라고 이름 붙였다.';}),speech:name=>`${name}님, 카페 별명이 뭐였죠?`,check:t=>! /구름찻집|별빛카페/.test(t)&&unknown(t)},
  {id:'fictional-origin',target:imagined.personaId,speech:name=>`${name}님, 그 정거장 이름 뭐였어요? 제가 진짜 우주에 다녀온 걸 보셨던가요?`,check:t=>/달빛정거장/.test(t)&&/가상|상상|연출/.test(t)&&/아니|실제.*(?:않|아닌)|진짜.*(?:아닌|아니)|실제로.*간.*건/.test(t)}
 ];
 for(const c of cases){const dir=join(folder,c.id);calls=[];phase=c.id;try{
  await cp(base,dir,{recursive:true,errorOnExist:true,force:false});service=await startServer({port:0,dataDir:dir,provider:relay,localSpeech:false});const s=service.studio;clearInterval(s.timer);s.audience.random=()=>0;s.random=()=>.5;c.edit?.(s);s.start();
  const name=s.settings.personas.find(p=>p.id===c.target).name,speech=c.speech(name);await s.react({speech});const call=calls[0];if(!call)throw Error('No live model call');
  const output=call.observation,text=output.messages.filter(m=>m.personaId===c.target).map(m=>m.text).join(' '),passed=!!text&&c.check(text)&&!output.positiveMoment.positive&&!output.positiveMoment.donations.length;
  report.results.push({id:c.id,passed,ms:call.ms,speech,target:c.target,messages:output.messages,arrivalClipMemory:call.args.viewerContext[c.target]?.arrivalClipMemory});
  console.log(JSON.stringify({id:c.id,passed,ms:call.ms,text}));
 }catch(error){report.results.push({id:c.id,passed:false,error:error.stack});console.log(JSON.stringify({id:c.id,error:error.message}));}finally{await service?.close();service=null;await writeFile(join(dir,'calls.json'),JSON.stringify(calls,null,2));await save();}}
 report.passed=report.results.length===cases.length&&report.results.every(r=>r.passed);
}catch(error){report.error=error.stack;}finally{await service?.close();await save();}
report.limit='Three real persona creations and eight isolated restart scenarios using the same synthetic baseline. Mechanical checks need full output review. Does not prove actual clip video/audio understanding or long-term social realism.';
await save();await writeFile('artifacts/clip-arrival-astra-result.json',JSON.stringify(report,null,2));console.log(JSON.stringify({folder,passed:report.passed}));if(!report.passed)process.exitCode=1;

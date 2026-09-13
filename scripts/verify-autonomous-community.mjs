// File/loopback-only acceptance: real subscribed-account model, synthetic profile,
// normal app timer, no user trigger endpoint, native UI or device access.
import {mkdir,mkdtemp,readFile,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash,randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {startServer} from '../server/index.js';
import {CodexProvider} from '../server/codex-provider.js';
import {Settings} from '../server/schema.js';
import {defaults} from '../shared/defaults.js';

await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve('artifacts/autonomous-astra-'));
const report={folder,synthetic:true,nativeApp:false,deviceCapture:false,model:'gpt-6-astra',effort:'low',passed:false,cases:[],sourceHashes:{}};
for(const f of ['server/community-activity.js','server/community-activity-state.js','server/community.js','server/clips.js','server/clip-memory.js','server/studio.js','server/provider.js','server/schema.js','server/index.js'])report.sourceHashes[f]=createHash('sha256').update(await readFile(f)).digest('hex');
let service;
try{
 const provider=new CodexProvider({...process.env,OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});await provider.check();assert.ok(provider.available,provider.authMessage);
 for(const kind of ['clip','gallery','review']){
  const evidence={kind,calls:[]};report.cases.push(evidence);
  service=await startServer({port:0,dataDir:join(folder,kind),localSpeech:false,provider:{status:()=>provider.status(),react:async(args,signal)=>{const call={input:provider.payload(args),startedAt:Date.now()};evidence.calls.push(call);const result=await provider.react(args,signal);Object.assign(call,{ms:Date.now()-call.startedAt,...result});return result;}}});
  const s=service.studio;
  s.world.change(d=>{
   d.settings=Settings.parse({...defaults,mode:'live',personas:defaults.personas.filter(p=>['momo','luna'].includes(p.id))});
   for(const p of d.settings.personas){d.audience.members[p.id]={sessions:1,seconds:600,recognized:0,affinity:.5,peers:{},memories:[]};s.economy.wallet(d.economy,p.id);}
  });
  if(kind==='clip'){
   const clip=s.clips.create({title:'정답이 바로 앞에 있었네',game:'합성 퍼즐',scene:'같은 자리를 여러 번 지나치다가 입구 옆 마지막 조각을 찾아 퍼즐을 완성했다.',participants:[],messages:[{id:randomUUID(),time:Date.now()-5000,personaId:'streamer',name:'플레이어',text:'아 이게 왜 여기 있어 ㅋㅋ 세 번이나 지나왔는데',kind:'streamer'}],sessionId:randomUUID(),source:'spectator'});
   s.clips.comment(clip.id,{name:'플레이어',text:'이거 또 못 보면 다음엔 진짜 입구부터 확인할게요 ㅋㅋ'});
  }else if(kind==='gallery')s.community.post({title:'내일은 게임 없이 수다 떨까 해요',text:'오늘 퍼즐 붙들고 있어서 목이 좀 쉬었네 ㅋㅋ 내일은 편하게 근황 이야기해요.',category:'공지'});
  else{
   const sessionId=randomUUID();for(const [i,text] of ['조각 여기 있는 거였네 ㅋㅋ','오늘은 결국 풀었다','수고했어요 다음에 또 봐요','UNWITNESSED_SYNTHETIC_TEXT'].entries())s.journal.record({id:randomUUID(),time:Date.now()-100000+i,personaId:'streamer',name:'플레이어',text,kind:'streamer'},{sessionId,witnesses:i<3?['momo']:[]});
  }
  // Advance only the isolated simulation clock, then let the real 250ms pump
  // choose the visitor and call the provider. No react/reflect endpoint is used.
  s.random=()=>0;s.now=()=>Date.now()+61000;
  const deadline=Date.now()+90000;
  while(Date.now()<deadline){if(evidence.calls.length&&!s.communityActivity.active)break;await new Promise(r=>setTimeout(r,100));}
  assert.equal(evidence.calls.length,1);assert.equal(s.communityActivity.active,null);assert.equal(s.communityActivity.lastError,'');
  const call=evidence.calls[0];assert.ok(call.observation);assert.ok(call.observation.messages.every(m=>m.personaId==='momo'));assert.ok(!JSON.stringify(call.input).includes('UNWITNESSED_SYNTHETIC_TEXT'));
  evidence.activity=structuredClone(s.audience.data.communityActivity);evidence.posts=structuredClone(s.audience.data.posts);evidence.clips=structuredClone(s.clips.data);
  assert.equal(kind==='clip'?evidence.clips[0].activityReads.length:kind==='gallery'?evidence.posts[0].activityReads.length:evidence.activity.reviews.length,1);
  const headers={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'};
  const rejected=await fetch(service.url+'/api/community/reflect',{method:'POST',headers,body:'{}'});assert.equal(rejected.status,410);
  const state=await (await fetch(service.url+'/api/state',{headers})).text();assert.ok(!state.includes('activityReads')&&!state.includes('metadataHash'));
  await service.close();service=null;evidence.passed=true;
 }
 report.passed=true;
}catch(error){report.error=error.stack;process.exitCode=1;}
finally{await service?.close();await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({folder,passed:report.passed,cases:report.cases.map(c=>({kind:c.kind,passed:c.passed,ms:c.calls[0]?.ms,messages:c.calls[0]?.observation?.messages,votes:c.calls[0]?.observation?.communityVotes})),error:report.error}));}

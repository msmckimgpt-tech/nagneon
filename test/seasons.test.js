import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Studio} from '../server/studio.js';
import {startServer} from '../server/index.js';
import {defaults} from '../shared/defaults.js';
import {seasonTemplates} from '../shared/seasons.js';
import {SeasonsData,emptySeasons} from '../server/seasons-schema.js';
const reply=(id='momo',text='선장님 그럼 조용한 별부터 가요 ㅋㅋ')=>({personaId:id,text,kind:'chat',spoiler:false});
const result=(messages=[reply()])=>({observation:{game:'Unreal victory',scene:'invented victory',confidence:1,excitement:1,positiveMoment:{positive:true,impact:1,reason:'fiction',signature:'never award',supporters:['momo']},messages},usage:{total_tokens:13}});
function setup(t,extra={}){let now=10000000;const requests=[];const s=new Studio({settings:{...defaults,mode:'live',lurkRatio:0,discovery:{...defaults.discovery,enabled:false}},now:()=>now,random:()=>0,provider:{status:()=>({configured:true}),react:async args=>{requests.push(args);return result([reply(args.settings.personas.find(p=>p.id==='momo')?.id||args.settings.personas[0].id)]);}},...extra});t.after(()=>s.close());return {s,requests,advance:ms=>now+=ms};}
const create=(s,templateId='our-room-v1')=>s.seasons.create({templateId,premise:'우리만의 이야기'});
async function acts(s){for(let i=0;i<3;i++)await s.seasons.advance({text:`내가 고르는 진행 멘트 ${i}`});}

test('all authored branches reach distinct chapters and both endings with a durable keepsake',async t=>{
  for(const template of seasonTemplates)for(const firstChoice of template.nodes[0].choices)for(const lastChoice of template.nodes.find(n=>n.id===firstChoice.next).choices){
    const {s}=setup(t);s.start();const item=create(s,template.id);s.seasons.resume({id:item.id,targets:['momo']});await acts(s);
    s.seasons.choose({id:item.id,choiceId:firstChoice.id});assert.equal(s.seasons.get(item.id).chapters[1].node,firstChoice.next);assert.equal(s.seasons.active,null);
    s.seasons.resume({id:item.id});await acts(s);s.seasons.choose({id:item.id,choiceId:lastChoice.id});s.seasons.resume({id:item.id});await acts(s);
    const final=s.seasons.choose({id:item.id});assert.equal(final.status,'completed');assert.equal(final.keepsake,template.nodes.find(n=>n.id===lastChoice.next).keepsake);assert.equal(final.decisions.length,2);assert.equal(s.calls,9);assert.equal(s.economy.data.balance,60);assert.deepEqual(s.knowledge.entries,{});assert.equal(s.observation,null);SeasonsData.parse(s.seasons.data);
  }
});

test('opening and resuming validate presence, duplicate cast and director conflicts without model calls',t=>{
  const {s}=setup(t);const a=create(s);assert.throws(()=>s.seasons.resume({id:a.id}),/방송/);s.start();assert.throws(()=>s.seasons.resume({id:a.id,targets:['momo','momo']}));assert.throws(()=>s.seasons.resume({id:a.id,targets:['manager']}));
  s.director.start({episodeId:'radio'});assert.throws(()=>s.seasons.resume({id:a.id}),/다른/);s.director.finish('interrupted');s.seasons.resume({id:a.id,targets:['momo']});assert.throws(()=>s.director.start({episodeId:'radio'}),/시즌/);assert.throws(()=>s.seasons.choose({id:a.id,choiceId:'radio'}),/세 장면/);assert.equal(s.calls,0);
});

test('stage save failure never advances the act, publishes messages or changes memory',async t=>{
  let fail=false,persisted;const {s}=setup(t,{saveSeasons:data=>{if(fail)throw new Error('disk full');persisted=structuredClone(data);}});s.start();const a=create(s);s.seasons.resume({id:a.id});const before=structuredClone(s.audience.data);fail=true;
  await assert.rejects(s.seasons.advance({text:'저장 실패 멘트'}),/disk full/);assert.equal(s.seasons.get(a.id).chapters[0].stage,-1);assert.equal(s.messages.length,0);assert.deepEqual(s.audience.data,before);assert.equal(persisted.seasons[0].chapters[0].stage,-1);assert.equal(s.calls,1);assert.equal(s.busy,false);
  fail=false;await s.seasons.advance({text:'재시도 성공'});assert.equal(s.seasons.get(a.id).chapters[0].stage,0);assert.equal(s.messages.length,2);assert.equal(s.calls,2);assert.equal(persisted.seasons[0].chapters[0].messages.length,2);
});

test('creation, choices, acceptance and removal commit only after persistence succeeds',async t=>{
  let fail=false;const {s}=setup(t,{saveSeasons:()=>{if(fail)throw new Error('save failed');}});fail=true;assert.throws(()=>create(s),/save failed/);assert.equal(s.seasons.data.seasons.length,0);fail=false;s.start();const a=create(s);s.seasons.resume({id:a.id});await acts(s);fail=true;assert.throws(()=>s.seasons.choose({id:a.id,choiceId:'radio'}),/save failed/);assert.equal(s.seasons.get(a.id).chapters.length,1);assert.ok(s.seasons.active);fail=false;s.seasons.pause();
  s.addMessage('momo','다음은 라디오 어때요');const p=await s.seasons.propose();fail=true;assert.throws(()=>s.seasons.respond({id:p.id,action:'accept'}),/save failed/);assert.equal(s.seasons.data.proposals[0].status,'suggested');assert.equal(s.seasons.data.seasons.length,1);assert.throws(()=>s.seasons.remove(a.id),/save failed/);assert.equal(s.seasons.data.seasons.length,1);
});

test('save adapters cannot mutate committed season objects',t=>{const {s}=setup(t,{saveSeasons:data=>{data.seasons.length=0;}});const a=create(s);assert.equal(s.seasons.get(a.id).title,'우리 방 첫 시즌');});

test('stop or pause cancels delayed stage output and queue without moving durable progress',async t=>{
  for(const stop of [false,true]){let done;const {s}=setup(t,{provider:{status:()=>({configured:true}),react:()=>new Promise(r=>done=r)}});s.start();const a=create(s);s.seasons.resume({id:a.id});const job=s.seasons.advance({text:'늦은 멘트'});if(stop){s.stop();s.start();}else s.seasons.pause();done(result());await assert.rejects(job,/취소/);assert.equal(s.seasons.get(a.id).chapters[0].stage,-1);assert.equal(s.messages.length,0);assert.equal(s.queue.length,0);assert.equal(s.busy,false);}
});

test('changed or absent cast and blocked/spoiler output cannot enter a stage',async t=>{
  let done;const {s}=setup(t,{provider:{status:()=>({configured:true}),react:()=>new Promise(r=>done=r)}});s.start();const a=create(s);s.seasons.resume({id:a.id,targets:['momo']});let job=s.seasons.advance();s.moderate('ban','momo');done(result());await assert.rejects(job,/표시/);assert.equal(s.seasons.get(a.id).chapters[0].stage,-1);
  s.moderate('unban','momo');job=s.seasons.advance();s.audience.presence.momo='away';done(result());await assert.rejects(job,/표시/);assert.equal(s.messages.length,0);
  s.audience.presence.momo='active';job=s.seasons.advance();done(result([{...reply(),spoiler:true},reply('unknown')]));await assert.rejects(job,/표시/);assert.equal(s.calls,3);
});

test('regular season conversation has fictional provenance, no observed victory, reward or game memory',async t=>{
  const {s,requests,advance}=setup(t);s.start();advance(120000);const a=create(s,'starlight-v1');s.seasons.resume({id:a.id});await s.react({image:'data:image/jpeg;base64,AAAA',speech:'우주 최강 보스를 잡았다는 설정!'});
  assert.equal(requests[0].directed.fictional,true);assert.equal(s.observation,null);assert.equal(s.economy.data.balance,60);assert.deepEqual(s.knowledge.entries,{});assert.equal(s.clips.list().length,0);advance(10000);s.pump();const published=s.messages.at(-1);assert.notEqual(published.personaId,'streamer');assert.equal(published.fictional,true);assert.match(s.audience.data.members[published.personaId].memories.at(-1),/가상 기획 방송/);assert.equal(s.journal.data.entries.find(e=>e.id===published.id).fictional,true);assert.equal(s.seasons.get(a.id).chapters[0].messages.length,2);s.seasons.pause();assert.equal(s.queue.length,0);
});

test('pausing regular season generation drops its late reaction',async t=>{
  let done;const {s}=setup(t,{provider:{status:()=>({configured:true}),react:()=>new Promise(r=>done=r)}});s.start();const a=create(s);s.seasons.resume({id:a.id});const job=s.react({speech:'내 연설'});s.seasons.pause();done(result());assert.equal((await job).skipped,'episode-ended');assert.equal(s.queue.length,0);assert.equal(s.observation,null);
});

test('new cast reads previous chapters as fiction and receives only its own memory packet',async t=>{
  const {s,requests,advance}=setup(t);s.start();const a=create(s);s.seasons.resume({id:a.id,targets:['momo']});await acts(s);s.seasons.choose({id:a.id,choiceId:'radio'});s.stop();advance(100000);s.start();s.seasons.resume({id:a.id,targets:['gg']});await s.seasons.advance({text:'전 회차 기록을 함께 읽어봐요'});
  const request=requests.at(-1);assert.equal(request.viewerContext.gg.chatHistory.length,0);assert.equal(request.viewerContext.momo,undefined);assert.equal(request.history.length,0);assert.equal(request.special.previousChapters[0].participants[0].id,'momo');assert.equal(request.special.recap[0].label,'새벽 라디오를 열자');assert.equal(request.audience.members[0].memories,undefined);
});

test('completed chapters produce idempotent fictional hotclips with actual speaking cast',async t=>{
  const {s}=setup(t);s.start();const a=create(s);s.seasons.resume({id:a.id});await acts(s);assert.throws(()=>s.seasons.clip({id:a.id,nodeId:'opening'}),/완료/);s.seasons.choose({id:a.id,choiceId:'festival'});const c=s.seasons.clip({id:a.id,nodeId:'opening'});assert.equal(c.source,'season-chapter');assert.equal(c.messages.length,6);assert.deepEqual(c.participants.map(p=>p.id),['momo']);assert.match(c.scene,/가상/);assert.equal(s.seasons.clip({id:a.id,nodeId:'opening'}).id,c.id);
});

test('chapter transcript has a bounded durable record and an explicitly shorter public preview',t=>{
  const {s}=setup(t);s.start();const a=create(s);s.seasons.resume({id:a.id});for(let i=0;i<140;i++)s.addMessage('momo','기록 '+i);assert.equal(s.seasons.get(a.id).chapters[0].messages.length,120);assert.equal(s.seasons.snapshot().seasons[0].chapters[0].messages.length,12);assert.equal(s.seasons.snapshot().seasons[0].chapters[0].messageCount,120);assert.equal(s.seasons.get(a.id).chapters[0].messages[0].text,'기록 20');
});

test('spectator proposals retain a real public source and accept atomically/idempotently without starting a broadcast',async t=>{
  const {s,requests}=setup(t);s.start();await assert.rejects(s.seasons.propose(),/대화/);const m=s.addMessage('momo','다음은 우주 원정을 해보고 싶어요');const p=await s.seasons.propose();assert.equal(p.templateId,'starlight-v1');assert.equal(p.source.id,m.id);assert.equal(p.source.fictional,false);assert.equal(requests[0].special.source.excerpt,m.text);assert.equal(s.messages.length,1);s.stop();const a=s.seasons.respond({id:p.id,action:'accept'});assert.equal(s.seasons.respond({id:p.id,action:'accept'}).id,a.id);assert.equal(s.seasons.data.seasons.length,1);assert.equal(s.seasons.active,null);assert.equal(s.running,false);
});

test('declining or snoozing a proposal does not punish affinity or charge points',async t=>{
  const {s}=setup(t);s.start();s.addMessage('momo','우리 방 방송이 좋네요');const p=await s.seasons.propose(),before=structuredClone(s.audience.data);const snooze=s.seasons.respond({id:p.id,action:'snooze'});assert.equal(snooze.snoozedUntil,s.now()+86400000);s.seasons.respond({id:p.id,action:'decline'});assert.deepEqual(s.audience.data,before);assert.equal(s.economy.data.balance,60);assert.equal(s.calls,1);
});

test('auto proposals are opt-in, live-only, once per session/hour with meaningful conversation and no catch-up',async t=>{
  const {s,advance}=setup(t);s.start();for(let i=0;i<20;i++)s.addMessage('momo','같이 다음 방송을 생각해요 '+i);advance(700000);s.seasons.maybePropose();assert.equal(s.calls,0);s.seasons.configure({autoProposals:true});s.seasons.maybePropose();await new Promise(r=>setImmediate(r));assert.equal(s.calls,1);s.seasons.maybePropose();assert.equal(s.calls,1);const attempt=s.seasons.data.lastAttemptAt;s.stop();advance(86400000);s.seasons.maybePropose();assert.equal(s.seasons.data.lastAttemptAt,attempt);s.start();s.seasons.maybePropose();assert.equal(s.calls,0);for(let i=0;i<20;i++)s.addMessage('momo','다시 생각해봐요 '+i);advance(600000);s.seasons.maybePropose();await new Promise(r=>setImmediate(r));assert.equal(s.calls,1);
});

test('failed automatic generation persists its attempted session and respects quota on a fresh instance',async t=>{
  let saved;const {s,advance}=setup(t,{saveSeasons:d=>saved=structuredClone(d),provider:{status:()=>({configured:true}),react:async()=>{throw new Error('network');}}});s.seasons.configure({autoProposals:true});s.start();for(let i=0;i<20;i++)s.addMessage('momo','기획 '+i);advance(700000);s.seasons.maybePropose();await new Promise(r=>setImmediate(r));assert.equal(s.calls,1);assert.equal(saved.lastAttemptSession,s.sessionId);advance(1000);s.seasons.maybePropose();assert.equal(s.calls,1);assert.equal(s.busy,false);
  const second=setup(t,{seasonsData:saved}).s;second.start();second.calls=second.settings.maxCalls;for(let i=0;i<20;i++)second.addMessage('momo','기획 '+i);second.seasons.maybePropose();assert.equal(second.seasons.data.proposals.length,0);
});

test('public API persists/resumes a season across servers and exports complete history',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'backseat-seasons-'));const provider=()=>({status:()=>({configured:true}),react:async()=>result()});let service=await startServer({port:0,dataDir:dir,localSpeech:false,provider:provider()});let id;
  try{const s=service.studio;s.configure({...s.settings,mode:'live',lurkRatio:0});s.start();id=create(s).id;s.seasons.resume({id});await s.seasons.advance({text:'첫 회차'});for(let i=0;i<20;i++)s.addMessage('momo','대화 '+i);}finally{await service.close();}
  service=await startServer({port:0,dataDir:dir,localSpeech:false,provider:provider()});try{
    const s=service.studio;assert.equal(s.running,false);assert.equal(s.seasons.active,null);assert.equal(s.seasons.get(id).chapters[0].stage,0);
    const headers={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'};
    const record=await (await fetch(service.url+'/api/seasons/'+id,{headers})).json();assert.equal(record.chapters[0].messages.length,22);
    const exported=await (await fetch(service.url+'/api/export',{headers})).json();assert.equal(exported.seasonsArchive.seasons[0].chapters[0].messages.length,22);
    assert.equal((await fetch(service.url+'/api/seasons/choose',{method:'POST',headers,body:JSON.stringify({id,choiceId:'radio'})})).status,409);
    s.start();s.seasons.resume({id});await s.seasons.advance({text:'두 번째 장면'});assert.equal(s.seasons.get(id).chapters[0].stage,1);assert.equal(JSON.parse(readFileSync(join(dir,'seasons.json'),'utf8')).seasons[0].chapters[0].stage,1);
  }finally{await service.close();}
});

test('corrupt graph references fail startup without creating unrelated files',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'backseat-season-corrupt-')),data=emptySeasons();data.seasons.push({id:crypto.randomUUID(),templateId:'missing',version:1,title:'lost',premise:'',createdAt:0,updatedAt:0,status:'open',chapters:[{node:'missing',stage:-1,startedAt:null,endedAt:null,sessionId:null,cast:[],messages:[],lines:[]}],decisions:[],keepsake:null});writeFileSync(join(dir,'seasons.json'),JSON.stringify(data));
  await assert.rejects(startServer({port:0,dataDir:dir,localSpeech:false,provider:{status:()=>({configured:true})}}),/백업이 없습니다/);assert.deepEqual(readdirSync(dir),['seasons.json']);
});

test('shelves and pending invitations are bounded and invalid graph edits are rejected',async t=>{
  const {s}=setup(t);for(let i=0;i<12;i++)create(s);assert.throws(()=>create(s),/보관함/);const bad=structuredClone(s.seasons.data);bad.seasons[0].chapters[0].node='radio';assert.equal(SeasonsData.safeParse(bad).success,false);s.start();s.addMessage('momo','같이 기획해요');for(let i=0;i<6;i++)await s.seasons.propose();await assert.rejects(s.seasons.propose(),/먼저/);assert.equal(s.calls,6);
});

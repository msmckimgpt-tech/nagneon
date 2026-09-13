import test from 'node:test';
import assert from 'node:assert/strict';
import {Studio} from '../server/studio.js';
import {startServer} from '../server/index.js';
import {defaults} from '../shared/defaults.js';
import {TrainingRun} from '../server/training.js';
import {OpenAIProvider} from '../server/provider.js';

const positive={positive:true,impact:1,reason:'연출된 환호',signature:'fictional award',supporters:['momo']};
const reply=(id='momo',text='시상식 사회자는 제가 할게요 ㅋㅋ')=>({personaId:id,text,kind:'chat',spoiler:false});
const result=(messages=[reply()])=>({observation:{game:'Real Game',scene:'claimed victory',confidence:1,excitement:1,positiveMoment:positive,messages},usage:{total_tokens:17}});
function setup(t,extra={}){let now=100000;const requests=[];const s=new Studio({settings:{...defaults,mode:'live',lurkRatio:0,discovery:{...defaults.discovery,enabled:false}},now:()=>now,provider:{status:()=>({configured:true}),react:async(args)=>{requests.push(args);return result();}},...extra});t.after(()=>s.close());return {s,requests,advance:ms=>now+=ms};}

test('practice is isolated from broadcast history, wallets, memories and call budget',t=>{
  const {s,advance}=setup(t);s.start();s.addMessage('momo','previous real chat');s.calls=3;s.stop();
  const before={messages:structuredClone(s.messages),audience:structuredClone(s.audience.data),economy:structuredClone(s.economy.data)};
  s.startTraining('criticism');assert.equal(s.trainingMessages.length,1);s.trainingAction('response','다른 취향도 존중해요.');advance(10000);s.pump();
  assert.equal(s.trainingMessages.length,3);assert.equal(s.calls,3);assert.throws(()=>s.start(),/연습/);assert.throws(()=>s.configure(s.settings),/연습/);
  const report=s.stopTraining();assert.equal(report.responses,1);assert.equal(report.eventsSent,2);assert.deepEqual(s.messages,before.messages);assert.deepEqual(s.audience.data,before.audience);assert.deepEqual(s.economy.data,before.economy);
});

test('panic stop ends rehearsal and prevents subsequent staged chat',t=>{
  const {s,advance}=setup(t);s.startTraining('opening');s.stop();const count=s.trainingMessages.length;advance(60000);s.pump();assert.equal(s.training.active,false);assert.equal(s.trainingMessages.length,count);
});

test('practice report action names cannot collide with JavaScript prototypes',()=>{
  const run=new TrainingRun();run.start('opening',defaults.personas);run.action('__proto__');run.action('constructor');const report=run.stop();assert.equal(report.actionCounts.__proto__,1);assert.equal(report.actionCounts.constructor,1);assert.equal({}.polluted,undefined);
});

test('directed episode supports live dialogue, three acts, persistent album and hotclip',async t=>{
  let persisted=[];const {s,requests}=setup(t,{saveDirector:data=>persisted=structuredClone(data)});s.start();s.director.start({episodeId:'awards',premise:'우주 최강 방장 시상식',targets:['momo','gg']});
  for(let i=0;i<3;i++)await s.director.advance({text:`진행 멘트 ${i}`});
  assert.equal(s.director.active.stage,2);assert.equal(s.director.active.messages.length,6);assert.equal(s.calls,3);assert.equal(requests[0].special.kind,'directed-episode');assert.equal(requests[0].special.premise,'우주 최강 방장 시상식');
  assert.equal(s.observation,null);assert.equal(s.economy.data.balance,60);assert.deepEqual(s.knowledge.entries,{});assert.match(s.audience.data.members.momo.memories[0],/가상 기획 방송/);
  const item=s.director.finish();assert.equal(persisted.length,1);assert.equal(s.director.active,null);const clip=s.director.clip(item.id);assert.equal(clip.source,'directed-episode');assert.match(clip.scene,/가상 기획 방송/);assert.equal(clip.messages.length,6);assert.equal(s.director.clip(item.id).id,clip.id);
});

test('director validates cast, live mode and prerequisites before any calls',async t=>{
  const {s}=setup(t);assert.throws(()=>s.director.start({episodeId:'awards'}),/방송/);s.start();
  assert.throws(()=>s.director.start({episodeId:'awards',targets:['momo','momo']}),/중복/);assert.throws(()=>s.director.start({episodeId:'awards',targets:['missing']}));assert.throws(()=>s.director.start({episodeId:'missing'}));
  s.director.start({episodeId:'awards'});assert.throws(()=>s.director.finish(),/남은/);assert.equal(s.calls,0);s.director.finish('interrupted');assert.equal(s.director.archive[0].messageCount,undefined);assert.equal(s.director.snapshot().archive[0].messageCount,0);
});

test('cancelled directed generation cannot leak dialogue or take over a new broadcast',async t=>{
  let resolve;const {s}=setup(t,{provider:{status:()=>({configured:true}),react:()=>new Promise(r=>resolve=r)}});s.start();s.director.start({episodeId:'alternate'});const job=s.director.advance();s.stop();s.start();resolve(result());await assert.rejects(job,/취소/);assert.equal(s.messages.length,0);assert.equal(s.director.archive[0].status,'interrupted');assert.equal(s.tokens,0);assert.equal(s.busy,false);
});

test('failed or filtered stage leaves the current act unchanged and charges only call budget',async t=>{
  let attempt=0;const {s}=setup(t,{provider:{status:()=>({configured:true}),react:async()=>{if(!attempt++)throw new Error('provider outage');return result([reply('unknown')]);}}});s.start();s.director.start({episodeId:'radio'});
  await assert.rejects(s.director.advance(),/outage/);await assert.rejects(s.director.advance(),/표시/);assert.equal(s.director.active.stage,-1);assert.equal(s.messages.length,0);assert.equal(s.calls,2);assert.equal(s.economy.data.balance,60);assert.equal(s.busy,false);
});

test('regular speech during a fantasy event receives context and cannot earn points or teach game facts',async t=>{
  const {s,requests,advance}=setup(t);s.start();advance(120000);s.audience.data.members.momo.seconds=180;s.director.start({episodeId:'legend'});
  await s.react({image:'data:image/jpeg;base64,AAAA',speech:'방금 우주 최강 보스를 잡았다는 설정이에요'});
  assert.equal(requests[0].directed.fictional,true);assert.equal(s.economy.data.balance,60);assert.equal(s.clips.list().length,0);assert.deepEqual(s.knowledge.entries,{});
});

test('ending an episode during regular generation discards the late staged response',async t=>{
  let done;const {s}=setup(t,{provider:{status:()=>({configured:true}),react:()=>new Promise(r=>done=r)}});s.start();s.director.start({episodeId:'awards'});const job=s.react({speech:'소감 시작!'});s.director.finish('interrupted');done(result());assert.deepEqual(await job,{skipped:'episode-ended'});assert.equal(s.queue.length,0);assert.equal(s.busy,false);
});

test('failed album persistence keeps the active story available for retry',async t=>{
  let fail=true;const {s}=setup(t,{saveDirector:()=>{if(fail)throw new Error('disk full');}});s.start();s.director.start({episodeId:'anniversary'});await s.director.advance();assert.throws(()=>s.director.finish('interrupted'),/disk full/);assert.ok(s.director.active);assert.equal(s.director.archive.length,0);fail=false;s.director.finish('interrupted');assert.equal(s.director.archive.length,1);
});

test('provider carries fictional context and explicitly separates it from observed facts',()=>{
  const p=new OpenAIProvider({});const request=p.payload({settings:defaults,history:[],directed:{title:'가상 시상식',fictional:true}});assert.match(request.input[0].content[0].text,/가상 시상식/);assert.match(request.instructions,/positiveMoment.positive=false/);assert.equal(request.reasoning.effort,'low');
});

test('HTTP practice, director and special routes reject missing or invalid inputs',async t=>{
  const service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true}),react:async()=>result()}});t.after(()=>service.close());
  const post=async(path,body)=>fetch(service.url+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio',Authorization:'Bearer '+service.accessToken},body:JSON.stringify(body)});
  assert.equal((await post('special/generate',{kind:'interview',personaId:'momo',requestId:crypto.randomUUID()})).status,400);
  assert.equal((await post('training/start',{id:'opening'})).status,200);assert.equal((await post('training/action',{action:'__proto__'})).status,400);assert.equal((await post('start',{})).status,409);
  const response=await post('training/action',{action:'response',text:'안녕하세요!'});assert.equal(response.status,200);assert.equal((await post('training/stop',{})).status,200);
  service.studio.configure({...service.studio.settings,mode:'live',lurkRatio:0});assert.equal((await post('start',{})).status,200);assert.equal((await post('director/start',{episodeId:'fan-festival'})).status,200);assert.equal((await post('director/advance',{text:'우리 축제 시작!'})).status,200);assert.equal((await post('director/finish',{status:'interrupted'})).status,200);
});

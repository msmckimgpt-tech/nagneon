import test from 'node:test';
import assert from 'node:assert/strict';
import {Studio} from '../server/studio.js';
import {startServer} from '../server/index.js';
import {defaults} from '../shared/defaults.js';
import {TrainingRun} from '../server/training.js';

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

test('HTTP practice, director and special routes reject missing or invalid inputs',async t=>{
  const service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true}),react:async()=>result()}});t.after(()=>service.close());
  const post=async(path,body)=>fetch(service.url+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio',Authorization:'Bearer '+service.accessToken},body:JSON.stringify(body)});
  assert.equal((await post('special/generate',{kind:'interview',personaId:'momo',requestId:crypto.randomUUID()})).status,400);
  assert.equal((await post('training/start',{id:'opening'})).status,200);assert.equal((await post('training/action',{action:'__proto__'})).status,400);assert.equal((await post('start',{})).status,409);
  const response=await post('training/action',{action:'response',text:'안녕하세요!'});assert.equal(response.status,200);assert.equal((await post('training/stop',{})).status,200);
  service.studio.configure({...service.studio.settings,mode:'live',lurkRatio:0});assert.equal((await post('start',{})).status,200);assert.equal((await post('director/start',{episodeId:'fan-festival'})).status,410);assert.equal((await post('director/advance',{text:'우리 축제 시작!'})).status,410);assert.equal((await post('director/finish',{status:'interrupted'})).status,410);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Studio} from '../server/studio.js';
import {defaults} from '../shared/defaults.js';
import {Knowledge} from '../server/knowledge.js';
import {Audience} from '../server/audience.js';
import {Settings} from '../server/schema.js';
import {OpenAIProvider} from '../server/provider.js';
import {startServer} from '../server/index.js';

const obs=(messages=[])=>({game:'Test Game',scene:'visible event',confidence:0.9,excitement:0.4,messages});
const msg=(id,text,extra={})=>({personaId:id,text,kind:'chat',spoiler:false,...extra});
const provider={status:()=>({configured:true}),react:async()=>({observation:obs(),usage:{total_tokens:5}})};
function make(t,extra={}){const studio=new Studio({provider,random:()=>0,...extra});t.after(()=>studio.close());return studio;}

test('stop cancels pending replies and late results cannot leak into next session',async t=>{
  let finish;const p={...provider,react:()=>new Promise(r=>finish=r)};const studio=make(t,{provider:p,settings:{...defaults,mode:'live',lurkRatio:0}});studio.start();
  const request=studio.react({speech:'hello'});studio.stop();studio.start();finish({observation:obs([msg('momo','late')]),usage:{total_tokens:100}});await request;
  assert.equal(studio.messages.length,0);assert.equal(studio.queue.length,0);assert.equal(studio.tokens,0);assert.equal(studio.busy,false);
});
test('moderation rejects unknown personas, duplicate text, spoilers, and banned words',t=>{
  let now=100000;const studio=make(t,{now:()=>now,settings:{...defaults,blockedWords:['bad'],chatPace:8}});studio.start();
  studio.accept(obs([msg('unknown','x'),msg('momo','BAD'),msg('pop','spoiler',{spoiler:true}),msg('gg','safe',{kind:'notice'}),msg('gg','safe')]));
  assert.equal(studio.queue.length,1);now+=20000;studio.pump();assert.equal(studio.messages[0].kind,'chat');
  studio.accept(obs([msg('pop','hello')]));studio.moderate('ban','pop');assert.equal(studio.queue.length,0);
});
test('per-person slow mode spaces messages without blocking another viewer',t=>{
  let now=100000;const studio=make(t,{now:()=>now,settings:{...defaults,chatPace:8,slowModeSeconds:5}});studio.start();studio.accept(obs([msg('momo','one'),msg('momo','two'),msg('pop','three')]));now+=10000;studio.pump();studio.pump();
  assert.deepEqual(studio.messages.map(m=>m.text),['one','three']);now+=5000;studio.pump();assert.equal(studio.messages.at(-1).text,'two');
});
test('request cap includes failed AI attempts and prevents later model calls',async t=>{
  let calls=0;const studio=make(t,{settings:{...defaults,mode:'live',maxCalls:1},provider:{...provider,react:async()=>{calls++;throw new Error('provider failed');}}});studio.start();await assert.rejects(studio.react({speech:'hello'}));
  studio.lastRequest=0;studio.retryAt=0;await assert.rejects(studio.react({speech:'again'}));assert.equal(calls,1);assert.equal(studio.calls,1);
});
test('knowledge tracks observed time with bounded gaps and keeps teachings separate',()=>{
  const k=new Knowledge();k.observe('Test','scene',1000);k.observe('Test','scene',11000);k.observe('Test','new',10000000);k.teach('Test','rule');
  assert.equal(k.get('Test').seconds,70);assert.equal(k.get('Test').observations.length,2);assert.equal(k.get('Test').notes.length,1);assert.ok(k.get('Test',1).familiarity>k.get('Test',0).familiarity);
  k.forget('Test');assert.equal(k.get('Test').seconds,0);
});
test('audience remembers visits, excludes lurkers, and wakes specifically addressed members',()=>{
  const s=Settings.parse({...defaults,lurkRatio:.9});const a=new Audience(undefined,()=>{},()=>0.1);a.start(s,100000);assert.equal(a.presence.momo,'lurking');
  const c=a.context(s,'모모 안녕');assert.equal(a.presence.momo,'active');assert.ok(c.eligible.includes('momo'));assert.equal(a.data.members.momo.recognized,1);assert.equal(a.data.members.momo.sessions,1);a.stop();a.start(s,200000);assert.equal(a.data.members.momo.sessions,2);
});
test('just chatting, voice cues, optional web search and persona values reach provider request',()=>{
  const p=new OpenAIProvider({});const s=Settings.parse({...defaults,category:'just-chatting',webSearch:true});const body=p.payload({settings:s,history:[],speech:'도와줘',voiceCues:{delivery:'작은 음량'},adviceRequested:true});
  assert.match(body.instructions,/just-chatting/);assert.match(body.input[0].content[0].text,/작은 음량/);assert.equal(body.tools[0].type,'web_search');assert.equal(body.model,'gpt-6-astra');assert.equal(body.reasoning.effort,'low');assert.equal(body.store,false);
});
test('local server validates cross-origin writes, persists settings, and exposes no credential',async t=>{
  const service=await startServer({port:0,persist:false,provider:{...provider},localSpeech:false});t.after(()=>service.close());
  const state=await(await fetch(service.url+'/api/state',{headers:{Authorization:'Bearer '+service.accessToken}})).json();assert.equal(state.running,false);assert.ok(!JSON.stringify(state).includes('apiKey'));
  const denied=await fetch(service.url+'/api/start',{method:'POST',headers:{Origin:'https://evil.example','X-Backseat-Client':'studio'}});assert.equal(denied.status,403);
  const headers={'Content-Type':'application/json','X-Backseat-Client':'studio',Authorization:'Bearer '+service.accessToken};
  const invalid=await fetch(service.url+'/api/settings',{method:'PUT',headers,body:JSON.stringify({...state.settings,maxCalls:-1})});assert.equal(invalid.status,400);
  const start=await fetch(service.url+'/api/start',{method:'POST',headers});assert.equal((await start.json()).running,true);
  const stop=await fetch(service.url+'/api/stop',{method:'POST',headers});assert.equal((await stop.json()).running,false);
});
test('prototype-like game titles remain isolated data keys',()=>{const k=new Knowledge();k.teach('__proto__','test');assert.equal(k.get('__proto__').notes[0].text,'test');assert.equal({}.notes,undefined);});
test('failure backoff prevents repeated model spending',async t=>{let calls=0;const s=make(t,{settings:{...defaults,mode:'live'},provider:{...provider,react:async()=>{calls++;throw new Error('fail');}}});s.start();await assert.rejects(s.react({speech:'hello'}));assert.deepEqual(await s.react({speech:'hello'}),{skipped:'backoff'});assert.equal(calls,1);});

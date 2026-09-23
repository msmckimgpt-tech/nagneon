import test from 'node:test';
import assert from 'node:assert/strict';
import {Audience} from '../server/audience.js';
import {Settings} from '../server/schema.js';
import {defaults} from '../shared/defaults.js';
import {Studio} from '../server/studio.js';

const settings=(mix={clip:100,guide:0,fan:0,discussion:0,browse:0})=>Settings.parse({...defaults,mode:'live',lurkRatio:0,discovery:{enabled:true,arrivalSeconds:10,mix}});
test('newcomers wait, cannot speak before joining, and gain only their own watch time',()=>{
  const s=settings(),a=new Audience(undefined,()=>{},()=>.5);a.start(s,100000);
  assert.equal(a.presence.gg,'waiting');assert.equal(a.data.members.gg.sessions,0);
  assert.ok(!a.context(s,'각보는고양이 안녕').eligible.includes('gg'));
  assert.equal(a.tick(s,109000).length,0);
  assert.equal(a.tick(s,110000).length,1);
  const joined=s.personas.find(p=>p.id!=='momo'&&p.id!=='luna'&&a.presence[p.id]==='active');
  assert.ok(joined);assert.equal(a.data.members[joined.id].seconds,0);assert.equal(a.data.members[joined.id].origin.key,'clip');
  a.tick(s,112000);assert.equal(a.data.members[joined.id].seconds,2);
  assert.equal(a.tick(s,1000000).length,1,'sleep does not admit every remaining newcomer in one burst');
});
test('changing inflow mix affects new arrivals but preserves returning members and memories',()=>{
  const a=new Audience(undefined,()=>{},()=>.1);a.start(settings(),100000);a.message('momo','내가 한 말',settings());a.stop();
  const s=settings({clip:0,guide:100,fan:0,discussion:0,browse:0});a.start(s,200000);a.tick(s,210000);
  assert.equal(a.data.members.momo.origin.key,'clip');assert.equal(a.data.members.momo.sessions,2);assert.deepEqual(a.data.members.momo.memories,['내가 한 말']);
  assert.equal(a.data.members.gg.origin.key,'guide');assert.match(a.context(s).members.find(m=>m.id==='gg').arrivalInterest,/훈수 정책/);
});
test('legacy settings stay compatible and invalid all-zero enabled mix is rejected',()=>{
  assert.equal(Settings.parse(defaults).discovery.enabled,false);
  assert.throws(()=>settings({clip:0,guide:0,fan:0,discussion:0,browse:0}));
});
test('arrival scheduler works without screen, speech or additional model calls',t=>{
  let now=100000;const a=new Audience(undefined,()=>{},()=>.1);const studio=new Studio({settings:settings(),now:()=>now,audience:a,provider:{status:()=>({configured:true})}});t.after(()=>studio.close());
  studio.start();now+=10000;studio.pump();assert.equal(studio.calls,0);assert.equal(a.data.members.gg.sessions,1);assert.ok(studio.events.some(e=>e.text.includes('각보는고양이 첫 방문')));
  studio.stop();now+=10000;studio.pump();assert.equal(a.data.members.pop.sessions,0);
});
test('ban and unban preserve waiting status and non-attendees cannot publish a recap',async t=>{
  let now=100000;const a=new Audience(undefined,()=>{},()=>.1);let received;
  const provider={status:()=>({configured:true}),react:async args=>{received=args;return {observation:{game:'Just Chatting',scene:'ended',confidence:1,excitement:0,messages:[{personaId:'gg',text:'내가 본 방송',kind:'chat',spoiler:false},{personaId:'momo',text:'다음에 또 봐요',kind:'chat',spoiler:false}]}};}};
  const studio=new Studio({settings:settings(),now:()=>now,audience:a,provider});t.after(()=>studio.close());studio.start();
  studio.moderate('ban','gg');studio.moderate('unban','gg');assert.equal(a.presence.gg,'waiting');assert.equal(a.data.members.gg.sessions,0);
  studio.addMessage('streamer','안녕하세요','streamer');studio.stop();studio.ai.update({features:{summary:true}});await studio.reflect();
  assert.ok(!received.settings.personas.some(p=>p.id==='gg'));assert.deepEqual(a.data.posts.map(p=>p.personaId),['momo']);
});

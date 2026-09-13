import test from 'node:test';
import assert from 'node:assert/strict';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {defaults} from '../shared/defaults.js';

const message=(text,personaId='momo',extra={})=>({personaId,text,kind:'chat',spoiler:false,...extra});
const observation=messages=>({game:'Synthetic',scene:'Synthetic conversation',confidence:.8,excitement:.1,messages});
function fixture(t,{latency=8000,messages=[message('첫 대답'),message('다른 관객의 이야기','pop')]}={}){
 let now=100000;
 const s=new Studio({settings:{...defaults,mode:'live',category:'just-chatting',lurkRatio:0,slowModeSeconds:0,chatPace:8,autoHighlights:false,blockedWords:['금지단어']},audience:new Audience(undefined,()=>{},()=>.5),random:()=>.5,now:()=>now,provider:{status:()=>({configured:true}),react:async()=>{now+=latency;return {observation:observation(messages)};}}});
 clearInterval(s.timer);s.start();t.after(()=>s.close());
 return {s,advance:ms=>now+=ms,now:()=>now,chats:()=>s.messages.filter(m=>m.kind==='chat')};
}

test('a slow live reply can appear on the next pump, with subsequent viewers still spaced',async t=>{
 const f=fixture(t);await f.s.react({speech:'각자 어떻게 생각하는지 말해 줘'});
 f.s.pump();assert.deepEqual(f.chats().map(m=>m.text),['첫 대답']);
 f.s.pump();assert.equal(f.chats().length,1,'Waiting for inference must not collapse the entire batch');
 f.advance(1399);f.s.pump();assert.equal(f.chats().length,1);
 f.advance(1);f.s.pump();assert.deepEqual(f.chats().map(m=>m.text),['첫 대답','다른 관객의 이야기']);
 const row=f.s.reactions.snapshot(f.s.queue).requests[0];assert.equal(row.modelMs,8000);assert.equal(row.firstDeliveryMs,8000);assert.equal(row.delivered,2);
});

test('a fast live reply waits only the remaining reaction time',async t=>{
 const f=fixture(t,{latency:300});await f.s.react({speech:'어떻게 생각해?'});
 f.s.pump();assert.equal(f.chats().length,0);f.advance(1099);f.s.pump();assert.equal(f.chats().length,0);
 f.advance(1);f.s.pump();assert.equal(f.chats().length,1);assert.equal(f.s.reactions.snapshot(f.s.queue).requests[0].firstDeliveryMs,1400);
});

test('filtered messages do not spend the first valid reply reaction credit',async t=>{
 const f=fixture(t,{messages:[message('금지단어'),message('스포일러','momo',{spoiler:true}),message('알 수 없는 관객','unknown'),message('첫 대답'),message('첫 대답')]});
 await f.s.react({speech:'편하게 이야기해 줘'});f.s.pump();assert.deepEqual(f.chats().map(m=>m.text),['첫 대답']);assert.equal(f.s.queue.length,0);
});

test('the faster first reply still respects slow mode, presence and stop',async t=>{
 const f=fixture(t,{messages:[message('첫 대답')]});f.s.settings.slowModeSeconds=15;f.s.lastSpeaker.set('momo',f.now());
 await f.s.react({speech:'어떻게 생각해?'});f.s.pump();assert.equal(f.chats().length,0);
 f.advance(6999);f.s.pump();assert.equal(f.chats().length,0);f.advance(1);f.s.pump();assert.equal(f.chats().length,1);
 for(const action of ['away','ban','stop']){
  const g=fixture(t,{messages:[message('첫 대답')]});await g.s.react({speech:'새로운 이야기'});
  if(action==='away')g.s.audience.setPresence('momo','away',g.now());else if(action==='ban')g.s.moderate('ban','momo');else g.s.stop();
  g.s.pump();assert.equal(g.chats().length,0,action);assert.equal(g.s.queue.length,0,action);
 }
});

test('response timing never treats an old observation as model waiting time',t=>{
 const f=fixture(t);f.s.accept(observation([message('첫 대답')]),f.now()-60000,false,'live');
 f.s.pump();assert.equal(f.chats().length,0);f.advance(1400);f.s.pump();assert.equal(f.chats().length,1);
});

test('rehearsal and directed activities retain their existing reaction timing',t=>{
 for(const [mode,origin] of [['rehearsal','live'],['live','directed'],['live','other']]){
  const f=fixture(t);f.s.settings.mode=mode;f.s.accept(observation([message('첫 대답')]),f.now(),false,origin,{responseStartedAt:f.now()-8000});
  f.s.pump();assert.equal(f.chats().length,0,`${mode}/${origin}`);f.advance(1400);f.s.pump();assert.equal(f.chats().length,1);
 }
});

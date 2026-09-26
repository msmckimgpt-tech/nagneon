import test from 'node:test';
import assert from 'node:assert/strict';
import {StateStream,StateFeed} from '../server/state-stream.js';
import {EventEmitter} from 'node:events';
import {applyStatePatch} from '../shared/state-patch.js';
import {startServer} from '../server/index.js';

function receive(state,frame){if(!frame)return state;const data=JSON.parse(frame.split('data: ')[1]);return frame.startsWith('event:')?applyStatePatch(state,data):data;}
const msg=i=>({id:String(i),personaId:'fixture',text:'검증 채팅 '+i+' '.repeat(80),time:i});

test('cached wire fields retain JSON semantics, nested edits and recovery after encoding failure',()=>{
  const encoder=new StateStream();
  const source={messages:[msg(1)],clock:new Date(0),optional:undefined,settings:{pace:1},value:NaN};
  let client=receive(null,encoder.encode(source));
  assert.deepEqual(client,JSON.parse(JSON.stringify(source)));
  assert.equal(encoder.encode(source),'');
  source.settings.pace=2;source.clock.setTime(1000);
  client=receive(client,encoder.encode(source));
  assert.deepEqual(client,JSON.parse(JSON.stringify(source)));
  source.circular=source;
  assert.throws(()=>encoder.encode(source),/circular/i);
  delete source.circular;delete source.settings;
  client=receive(client,encoder.encode(source));
  source.settings={pace:2};
  client=receive(client,encoder.encode(source));
  assert.deepEqual(client,JSON.parse(JSON.stringify(source)));
  assert.equal(encoder.encode(source),'');
});
test('stalled window coalesces snapshots and display changes and drops its drain listener on close',()=>{
  let source={messages:[msg(1)],settings:{showStreamerMessages:true}},accept=false;
  const response=new EventEmitter(),frames=[];response.write=frame=>{frames.push(frame);return accept;};
  const feed=new StateFeed(response,{patches:true,currentState:()=>source});feed.send(source);
  let client=receive(null,frames[0]);
  for(let i=2;i<1000;i++){source={...source,messages:[msg(i)]};feed.send(source);}
  source.settings={showStreamerMessages:false};feed.display(source.settings);
  assert.equal(frames.length,1);accept=true;response.emit('drain');
  assert.equal(frames.length,2);client=receive(client,frames[1]);assert.deepEqual(client,source);
  feed.close();assert.equal(response.listenerCount('drain'),0);feed.send(source);assert.equal(frames.length,2);
});
test('overlay drain projects its latest full state before patch encoding',()=>{
  let source={messages:[msg(1)],decision:{configured:false}},accept=false;
  const response=new EventEmitter(),frames=[];response.write=frame=>{frames.push(frame);return accept;};
  const feed=new StateFeed(response,{patches:true,surface:'overlay',currentState:()=>source});feed.send(source);
  let client=receive(null,frames[0]);assert.equal('decision' in client,false);
  source={messages:[msg(2)],decision:{configured:true,counters:{calls:1}}};feed.send(source);
  accept=true;response.emit('drain');client=receive(client,frames[1]);
  assert.deepEqual(client.messages,[msg(2)]);assert.equal('decision' in client,false);
  assert.equal(frames.every(frame=>!frame.includes('decision')),true);feed.close();
});
test('patches preserve state through append, 500 message rollover, correction, reorder, delete and clear',()=>{
  const encoder=new StateStream();let source={messages:Array.from({length:500},(_,i)=>msg(i)),settings:{showStreamerMessages:true},calls:0};
  let client=receive(null,encoder.encode(source));const retained=client.messages[20],settings=client.settings;
  source.messages=[...source.messages.slice(1),msg(500)];let frame=encoder.encode(source);client=receive(client,frame);
  assert.deepEqual(client,source);assert.equal(client.messages[19],retained);assert.equal(client.settings,settings);
  assert.ok(Buffer.byteLength(frame)<1000,'rolling history should send only removal and append');
  source.messages[30].text='원문';source.messages[30].transcription={correction:{text:'교정된 말'}};
  client=receive(client,encoder.encode(source));assert.deepEqual(client,source);assert.equal(client.messages[19],retained);
  source.messages.reverse();client=receive(client,encoder.encode(source));assert.deepEqual(client,source);
  source.messages=source.messages.filter(m=>m.id!=='31');client=receive(client,encoder.encode(source));assert.deepEqual(client,source);
  source.messages=[];client=receive(client,encoder.encode(source));assert.deepEqual(client,source);
  assert.equal(encoder.encode(source),'','identical heartbeat should not resend state');
});
test('full snapshots recover reconnects, field removal and duplicate ids without stale state',()=>{
  const encoder=new StateStream();let source={messages:[msg(1)],temporary:true};let client=receive(null,encoder.encode(source));
  delete source.temporary;client=receive(client,encoder.encode(source));assert.deepEqual(client,source);
  source.messages=[msg(1),msg(1)];client=receive(client,encoder.encode(source));assert.deepEqual(client,source);
  assert.deepEqual(receive(null,new StateStream().encode(source)),source);
  assert.throws(()=>applyStatePatch(null,{set:{}}),/initial snapshot/);
});
test('real SSE patch stream preserves display toggles, and reconnect starts with current full state',{timeout:10000},async t=>{
  const service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true})}});t.after(()=>service.close());
  const s=service.studio;s.messages=Array.from({length:500},(_,i)=>msg(i));
  async function connect(){
    const controller=new AbortController();t.after(()=>controller.abort());
    const response=await fetch(service.url+'/api/events?transport=patches',{headers:{Authorization:'Bearer '+service.accessToken},signal:controller.signal});
    assert.equal(response.status,200);const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    return {close:()=>controller.abort(),next:async()=>{while(!buffer.includes('\n\n')){const {value,done}=await reader.read();assert.equal(done,false);buffer+=decoder.decode(value,{stream:true});}const index=buffer.indexOf('\n\n');const frame=buffer.slice(0,index+2);buffer=buffer.slice(index+2);return frame;}};
  }
  const a=await connect(),b=await connect();const full=await a.next();let client=receive(null,full);await b.next();
  s.messages=[...s.messages.slice(1),msg(500)];s.publish();const patch=await a.next();assert.equal(await b.next(),patch);client=receive(client,patch);assert.deepEqual(client.messages,s.messages);
  s.setChatDisplay(false);const display=await a.next();await b.next();assert.match(display,/event: chat-display/);client={...client,settings:{...client.settings,showStreamerMessages:false}};
  s.publish();client=receive(client,await a.next());await b.next();assert.deepEqual(client,s.state());
  a.close();b.close();const c=await connect();const reconnected=await c.next();assert.match(reconnected,/^data: /);assert.deepEqual(receive(null,reconnected),s.state());c.close();
  t.diagnostic(JSON.stringify({fullBytes:Buffer.byteLength(full),rolloverPatchBytes:Buffer.byteLength(patch),messages:500,windows:2}));
});

test('overlay projection excludes private decision from REST and every SSE update, drain and reconnect', {timeout:10000}, async t => {
  const service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true})}});
  t.after(()=>service.close());
  const auth={Authorization:'Bearer '+service.accessToken};
  const publicState=await (await fetch(service.url+'/api/state?surface=overlay',{headers:auth})).json();
  assert.equal('decision' in publicState,false);
  assert.ok((await (await fetch(service.url+'/api/state',{headers:auth})).json()).decision);
  async function connect(){
    const controller=new AbortController();t.after(()=>controller.abort());
    const response=await fetch(service.url+'/api/events?transport=patches&surface=overlay',{headers:auth,signal:controller.signal});
    const reader=response.body.getReader(),decoder=new TextDecoder();let buffer='';
    return {close:()=>controller.abort(),next:async()=>{while(!buffer.includes('\n\n')){const {value,done}=await reader.read();assert.equal(done,false);buffer+=decoder.decode(value,{stream:true});}const end=buffer.indexOf('\n\n');const frame=buffer.slice(0,end+2);buffer=buffer.slice(end+2);return frame;}};
  }
  const a=await connect();let state=receive(null,await a.next());assert.equal('decision' in state,false);
  service.studio.decision.setKey('synthetic-secret');service.studio.messages=[msg(1)];service.studio.publish();
  state=receive(state,await a.next());assert.equal('decision' in state,false);
  assert.equal(JSON.stringify(state).includes('configured'),JSON.stringify(publicState).includes('configured'));
  a.close();const b=await connect();state=receive(null,await b.next());assert.equal('decision' in state,false);b.close();
});

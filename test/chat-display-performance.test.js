import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {startServer} from '../server/index.js';

async function subscribe(service){
  const controller=new AbortController();
  const response=await fetch(service.url+'/api/events',{headers:{Authorization:'Bearer '+service.accessToken},signal:controller.signal});
  const reader=response.body.getReader(),decoder=new TextDecoder();let buffered='';
  return {close:()=>controller.abort(),async next(){
    while(!buffered.includes('\n\n')){const {value,done}=await reader.read();assert.equal(done,false);buffered+=decoder.decode(value,{stream:true});}
    const end=buffered.indexOf('\n\n'),frame=buffered.slice(0,end);buffered=buffered.slice(end+2);return frame;
  }};
}

test('display toggles send only a small patch to both windows without full state reconstruction or listener accumulation', {timeout:15000},async t=>{
  const service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true})}});
  t.after(()=>service.close());const s=service.studio;
  s.messages=Array.from({length:500},(_,i)=>({id:String(i),personaId:i%2?'streamer':'momo',kind:i%2?'streamer':'chat',text:'합성 채팅 기록 '.repeat(30),time:i,name:'합성',color:'#ffffff'}));
  const first=await subscribe(service),second=await subscribe(service);t.after(()=>{first.close();second.close();});
  const initial=await first.next();await second.next();assert.equal(s.listenerCount('chat-display'),2);
  const messages=s.messages;let snapshots=0,patches=0,saves=0;
  const state=s.state.bind(s),persist=s.persist;s.state=()=>{snapshots++;return state();};s.persist=value=>{saves++;persist(value);};
  const patch=()=>patches++;s.on('chat-display',patch);
  const headers={'Content-Type':'application/json','X-Backseat-Client':'studio',Authorization:'Bearer '+service.accessToken};
  let patchBytes=0;
  for(let i=0;i<20;i++){
    const showStreamerMessages=Boolean(i%2);
    const response=await fetch(service.url+'/api/chat/display',{method:'POST',headers,body:JSON.stringify({showStreamerMessages})});assert.equal(response.status,200);
    const frame=await first.next();assert.equal(await second.next(),frame);
    assert.equal(frame,`event: chat-display\ndata: ${JSON.stringify({showStreamerMessages})}`);
    patchBytes+=Buffer.byteLength(frame+'\n\n');
  }
  assert.equal(snapshots,0);assert.equal(patches,20);assert.equal(saves,20);assert.equal(s.messages,messages);assert.equal(s.calls,0);
  s.setChatDisplay(true);assert.equal(saves,20);assert.equal(patches,20);
  assert.throws(()=>s.setChatDisplay('false'));assert.equal(saves,20);
  s.persist=()=>{throw Error('disk full');};assert.throws(()=>s.setChatDisplay(false),/disk full/);assert.equal(s.settings.showStreamerMessages,true);assert.equal(patches,20);
  s.persist=persist;
  t.diagnostic(JSON.stringify({toggles:20,syntheticMessages:500,fullStateBytesPerWindow:Buffer.byteLength(initial+'\n\n'),patchBytesFor20TogglesPerWindow:patchBytes,fullStateReconstructions:snapshots}));
  first.close();second.close();s.off('chat-display',patch);
  for(let i=0;i<50&&s.listenerCount('chat-display');i++)await delay(10);
  assert.equal(s.listenerCount('chat-display'),0);assert.equal(s.listenerCount('state'),0);
  const reconnected=await subscribe(service);t.after(()=>reconnected.close());
  assert.equal(JSON.parse((await reconnected.next()).slice(6)).settings.showStreamerMessages,true);
});

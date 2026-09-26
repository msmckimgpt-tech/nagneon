import test from 'node:test';
import assert from 'node:assert/strict';
import {createOverlayChatRelay} from '../src/overlay-chat.ts';

function pair(options={}) {
  const name='overlay-test-'+crypto.randomUUID();
  const accepted=[];
  let state={running:true,sessionId:'session-one'};
  const main=createOverlayChatRelay(new BroadcastChannel(name),{getState:()=>state,accept:text=>{accepted.push(text);return options.accept!==false;}});
  const overlay=createOverlayChatRelay(new BroadcastChannel(name),{timeoutMs:500});
  return {main,overlay,accepted,setState:s=>state=s,close(){main.close();overlay.close();}};
}
test('overlay speech is accepted once by the main queue and acknowledged',async()=>{
  const p=pair();try { assert.equal(await p.overlay.send(' 안녕하세요 ','session-one'),true);assert.deepEqual(p.accepted,['안녕하세요']); } finally{p.close();}
});
test('old session and stopped broadcast reject without enqueueing',async()=>{
  const p=pair();try {await assert.rejects(p.overlay.send('old','old-session'));p.setState({running:false,sessionId:'session-one'});await assert.rejects(p.overlay.send('stopped','session-one'));assert.deepEqual(p.accepted,[]);}finally{p.close();}
});
test('queue rejection and missing main window never report acceptance',async()=>{
  const p=pair({accept:false});try{await assert.rejects(p.overlay.send('full','session-one'));p.main.close();await assert.rejects(p.overlay.send('absent','session-one'));}finally{p.close();}
});
test('closing the overlay settles pending requests',async()=>{
  const name='overlay-test-'+crypto.randomUUID();const relay=createOverlayChatRelay(new BroadcastChannel(name));const pending=relay.send('pending','session-one');relay.close();await assert.rejects(pending);
});

test('duplicate delivery acknowledges without adding another speech; malformed requests cannot enqueue',async()=>{
  const name='overlay-test-'+crypto.randomUUID();const accepted=[];
  const main=createOverlayChatRelay(new BroadcastChannel(name),{getState:()=>({running:true,sessionId:'one'}),accept:text=>{accepted.push(text);return true;}});
  const sender=new BroadcastChannel(name);
  const send=payload=>new Promise(resolve=>{sender.onmessage=({data})=>resolve(data);sender.postMessage(payload);});
  try {
    const request={type:'chat-send',id:'same',text:'hello',sessionId:'one'};
    assert.equal((await send(request)).error,undefined);assert.equal((await send(request)).error,undefined);
    assert.equal(typeof (await send({...request,id:'empty',text:' '})).error,'string');
    assert.equal(typeof (await send({...request,id:'long',text:'x'.repeat(3001)})).error,'string');
    assert.deepEqual(accepted,['hello']);
  }finally{main.close();sender.close();}
});

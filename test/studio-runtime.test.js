import test from 'node:test';
import assert from 'node:assert/strict';
import {Studio} from '../server/studio.js';
import {startServer} from '../server/index.js';

test('a runtime disconnect failure cannot keep a broadcast or another connection alive',t=>{
  const s=new Studio({provider:{status:()=>({configured:false})}});t.after(()=>s.close());
  let disconnected=false;
  s.attachRuntime({snapshot:()=>({connected:!disconnected}),beforeStop:[
    ['broken',()=>{throw Error('disconnect failed');}],
    ['other',()=>{disconnected=true;}],
  ]});
  s.start();const signal=s.controller.signal;s.queue.push({text:'pending'});s.stop();
  assert.equal(s.running,false);assert.equal(signal.aborted,true);assert.equal(s.queue.length,0);
  assert.equal(disconnected,true);assert.equal(s.state().connected,false);assert.match(s.lastError,/broken/);
});

test('server runtime publishes all connection and onboarding state through the same snapshot',async t=>{
  const app=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:false})}});t.after(()=>app.close());
  const headers={Authorization:'Bearer '+app.accessToken,'X-Backseat-Client':'studio'};
  for(const action of ['start','stop']){
    const response=await fetch(app.url+'/api/'+action,{method:'POST',headers});assert.equal(response.status,200);
    const state=await response.json();assert.equal(state.running,action==='start');
    for(const key of ['onboarding','tutorial','connectionProbe','obsInput','debug','externalChat'])assert.ok(state[key],key);
    assert.equal(JSON.stringify(state).includes(app.accessToken),false);
  }
});

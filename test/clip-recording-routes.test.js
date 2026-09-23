import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {mkdtempSync,rmSync,readdirSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {request as httpRequest} from 'node:http';
import {createServer} from 'node:http';
import express from 'express';
import {Clips} from '../server/clips.js';
import {clipRecordingRoutes} from '../server/clip-recording-routes.js';
import {listenBrowserLoopback} from '../server/browser-loopback.js';

const bytes=Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.alloc(120)]);
async function harness({uploadTimeoutMs}={}){
  const dir=mkdtempSync(join(tmpdir(),'backseat-clip-route-')),now=Date.now();let failSave=false;
  const clips=new Clips({dir:join(dir,'media'),save:()=>{if(failSave)throw Error('disk full');}});
  const studio=Object.assign(new EventEmitter(),{epoch:1,running:true,sessionId:'s',settings:{autoHighlights:true,clipBufferEnabled:true},publish(){this.emit('state');}});
  const create=()=>clips.create({title:'Synthetic fixture',scene:'Fixture',game:'Test',sessionId:'s',source:'spectator',creator:{id:'viewer'},participants:[],messages:[],observedAt:now-1000,audioEligible:true});
  const clip=create();let pending,calls=0;
  // Deliberately controllable decoder boundary: these tests target HTTP races
  // and persistence. Python acceptance separately decodes real media bytes.
  const inspector={inspect:(_bytes,_metadata,signal)=>{calls++;return new Promise((resolve,reject)=>{pending={resolve,reject,signal};});}};
  const app=express();clipRecordingRoutes(app,{studio,clips,inspector,uploadTimeoutMs});
  app.use((err,_req,res,_next)=>{if(!res.headersSent)res.status(409).json({error:err.message});});
  const server=await listenBrowserLoopback(createServer(app));
  const url=`http://127.0.0.1:${server.address().port}`;
  return {clips,studio,clip,create,dir,url,now,get pending(){return pending;},get calls(){return calls;},failSave(){failSave=true;},
    send:(id=clip.id,signal)=>fetch(`${url}/api/clips/${id}/audio?startedAt=${now-15000}&endedAt=${now}&hasAudio=true`,{method:'POST',headers:{'Content-Type':'audio/webm'},body:bytes,signal}),
    wait:async()=>{for(let i=0;i<100&&!pending;i++)await delay(5);assert.ok(pending);},
    media:()=>existsSync(join(dir,'media'))?readdirSync(join(dir,'media')):[],
    close:async()=>{pending?.resolve();server.closeAllConnections();await new Promise(r=>server.close(r));rmSync(dir,{recursive:true,force:true});}};
}

test('HTTP saves only after decoding, while a concurrent request is rejected before decoding',async()=>{
  const h=await harness();try{const first=h.send();await h.wait();assert.deepEqual(h.media(),[]);assert.equal(h.clips.get(h.clip.id).audio,false);
    const busy=await h.send();assert.equal(busy.status,429);assert.equal(busy.headers.get('retry-after'),'1');await busy.arrayBuffer();assert.equal(h.calls,1);
    h.pending.resolve();const res=await first;assert.equal(res.status,200);assert.equal((await res.json()).audio,true);assert.deepEqual(h.media(),[h.clip.id+'.webm']);assert.equal(h.studio.listenerCount('state'),0);
  }finally{await h.close();}
});
for(const action of ['delete','stop','restart','disable','other-session','age-out'])test(`inspection cannot commit after ${action}, including a late successful decoder`,async()=>{
  const h=await harness();try{const request=h.send();await h.wait();
    if(action==='delete')h.clips.remove(h.clip.id);
    if(action==='stop'){h.studio.running=false;h.studio.epoch++;}
    if(action==='restart')h.studio.epoch++;
    if(action==='disable'){h.studio.settings.clipBufferEnabled=false;h.studio.publish();assert.equal(h.pending.signal.aborted,true);h.studio.settings.clipBufferEnabled=true;}
    if(action==='other-session')h.studio.sessionId='other';
    if(action==='age-out')h.clips.now=()=>Date.now()+121000;
    h.pending.resolve();const res=await request;assert.equal(res.status,409);await res.arrayBuffer();assert.deepEqual(h.media(),[]);if(action!=='delete')assert.equal(h.clips.get(h.clip.id).audio,false);assert.equal(h.studio.listenerCount('state'),0);
  }finally{await h.close();}
});
test('disconnect aborts inspection and cannot leave a file or listener',async()=>{
  const h=await harness();try{const c=new AbortController(),p=h.send(h.clip.id,c.signal);const rejected=assert.rejects(p);await h.wait();c.abort();await rejected;for(let i=0;i<100&&!h.pending.signal.aborted;i++)await delay(5);assert.equal(h.pending.signal.aborted,true);h.pending.resolve();await delay(10);assert.deepEqual(h.media(),[]);assert.equal(h.clips.get(h.clip.id).audio,false);assert.equal(h.studio.listenerCount('state'),0);
  }finally{await h.close();}
});
test('decode and persistence failures retain the text clip and release the upload slot',async()=>{
  for(const failure of ['decoder','disk']){const h=await harness();try{const request=h.send();await h.wait();if(failure==='decoder')h.pending.reject(Error('invalid recording'));else{h.failSave();h.pending.resolve();}const res=await request;assert.equal(res.status,409);await res.arrayBuffer();assert.deepEqual(h.media(),[]);assert.equal(h.clips.get(h.clip.id).audio,false);assert.equal(h.studio.listenerCount('state'),0);
    const second=h.send();for(let i=0;i<100&&h.calls<2;i++)await delay(5);assert.equal(h.calls,2);h.pending.reject(Error('fixture end'));await (await second).arrayBuffer();
  }finally{await h.close();}}
});
test('invalid media gets a permanent 422 response; decoder capacity remains retryable',async()=>{
  for(const [code,status] of [['clip-invalid',422],['clip-busy',429],['clip-unavailable',503],['clip-timeout',504]]){
    const h=await harness();try{const p=h.send();await h.wait();h.pending.reject(Object.assign(Error('fixture decoder error'),{code}));const res=await p;assert.equal(res.status,status);await res.arrayBuffer();assert.deepEqual(h.media(),[]);assert.equal(h.clips.get(h.clip.id).audio,false);}finally{await h.close();}
  }
});
test('a stalled partial upload times out, closes its socket, and frees the body slot',async()=>{
  const h=await harness({uploadTimeoutMs:200});let request;
  try{
    let closed=false;
    const status=await new Promise((resolve,reject)=>{
      request=httpRequest(`${h.url}/api/clips/${h.clip.id}/audio?startedAt=${h.now-15000}&endedAt=${h.now}&hasAudio=true`,{method:'POST',headers:{'Content-Type':'audio/webm','Content-Length':10000}},res=>{res.resume();res.once('end',()=>resolve(res.statusCode));});
      request.on('error',reject);request.on('close',()=>{closed=true;});request.write(bytes.subarray(0,4));
    });
    assert.equal(status,408);for(let i=0;i<100&&!closed;i++)await delay(5);assert.equal(closed,true);assert.equal(h.calls,0);assert.deepEqual(h.media(),[]);
    const next=h.send();await h.wait();h.pending.resolve();assert.equal((await next).status,200);
  }finally{request?.destroy();await h.close();}
});

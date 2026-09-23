import test from 'node:test';
import assert from 'node:assert/strict';
import {startTemporalCapture} from '../src/temporal-capture.ts';
import {TemporalFrames} from '../src/temporal-frames.ts';

const flush=()=>new Promise(resolve=>setImmediate(resolve));
const image='data:image/jpeg;base64,YQ==';
function fixture(){
  let tick,at=1000,canceled=0;
  const ring=new TemporalFrames();ring.reset('session','source');
  const video={videoWidth:960,videoHeight:960,readyState:2,currentTime:1,paused:false,ended:false};
  const pending=[],canvases=[],errors=[];
  const canvas=()=>{const draws=[];const c={width:0,height:0,draws,getContext:()=>({drawImage:(...args)=>draws.push(args),getImageData:()=>({data:new Uint8ClampedArray(32*18*4)})})};canvases.push(c);return c;};
  const stop=startTemporalCapture(video,ring,e=>errors.push(e),{
    now:()=>at,canvas,schedule:fn=>{tick=fn;return 1;},cancel:()=>canceled++,
    encode:(c,quality)=>new Promise((resolve,reject)=>pending.push({canvas:c,quality,resolve,reject}))
  });
  return {ring,video,pending,canvases,errors,stop,tick:()=>tick(),advance:()=>{at+=500;video.currentTime++;},canceled:()=>canceled};
}

test('async capture has one pending encoder and retains the capture timestamp',async()=>{
  const f=fixture();assert.equal(f.ring.samples.length,0);
  for(let i=0;i<5;i++){f.advance();f.tick();}
  assert.equal(f.pending.length,1);
  f.pending[0].resolve(image);await flush();
  assert.deepEqual(f.ring.samples.map(x=>[x.image,x.at]),[[image,1000]]);
  f.tick();assert.equal(f.pending.length,2);
  f.pending[1].resolve(image);await flush();
  assert.equal(f.ring.samples.at(-1).at,3500);
  f.stop();
});

test('stop rejects late success and failure without clearing later buffer contents',async()=>{
  for(const fail of [false,true]){
    const f=fixture();f.stop();f.ring.reset('next-session','next-source');f.ring.add(image,9000);
    if(fail)f.pending[0].reject(Error('late'));else f.pending[0].resolve(image);
    await flush();assert.equal(f.ring.samples.length,1);assert.equal(f.ring.samples[0].at,9000);
    assert.deepEqual(f.errors,[]);assert.equal(f.canvases[0].width,0);assert.equal(f.canceled(),1);
  }
});

test('source and session replacements discard pending encodes without resetting the new owner',async()=>{
  for(const field of ['sourceId','sessionId']){
    for(const fail of [false,true]){
      const f=fixture();f.ring[field]='replacement';f.ring.add(image,9000);
      if(fail)f.pending[0].reject(Error('old source'));else f.pending[0].resolve('x'.repeat(320001));
      await flush();assert.equal(f.pending.length,1);assert.equal(f.ring.samples[0].at,9000);assert.deepEqual(f.errors,[]);
      f.stop();
    }
  }
});

test('oversized fallback resizes the frozen canvas rather than sampling newer video',async()=>{
  const f=fixture();f.advance();
  f.pending[0].resolve('x'.repeat(320001));await flush();
  assert.equal(f.pending[1].quality,.35);assert.equal(f.pending[1].canvas,f.canvases[0]);
  f.advance();f.pending[1].resolve('x'.repeat(320001));await flush();
  const reduced=f.canvases[2];assert.equal(reduced.width,624);assert.equal(reduced.height,624);
  assert.equal(reduced.draws[0][0],f.canvases[0]);
  assert.equal(f.canvases[0].draws.length,1);
  f.pending[2].resolve(image);await flush();
  assert.equal(f.ring.samples[0].at,1000);assert.equal(f.ring.samples[0].image,image);
  f.stop();assert.equal(reduced.width,0);
});

test('active encoding failure reports once and releases owned resources',async()=>{
  const f=fixture();f.pending[0].reject(Error('encoder failed'));await flush();
  assert.equal(f.errors.length,1);assert.match(f.errors[0].message,/encoder failed/);
  assert.equal(f.ring.samples.length,0);assert.equal(f.ring.sessionId,'');
  assert.equal(f.canvases[0].width,0);assert.equal(f.canceled(),1);
  f.advance();f.tick();assert.equal(f.pending.length,1);f.stop();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {setTimeout as delay} from 'node:timers/promises';
import {ClipUploads} from '../src/clip-uploads.ts';

async function run(status,alreadySaved=false){
  const calls=[],errors=[],now=Date.now(),clip={id:'fixture',source:'spectator',sessionId:'s',video:false,audioEligible:true,createdAt:now,observedAt:now};
  const queue=new ClipUploads({sessionId:'s',allowed:()=>true,retryDelays:[0,0],onError:m=>errors.push(m),takeAt:async()=>({kind:'audio',blob:new Blob(['fixture']),sessionId:'s',hasAudio:true,startedAt:now-15000,endedAt:now}),
    request:async(_path,options)=>{calls.push(options.method||'GET');return options.method?Response.json({error:'fixture rejected'},{status}):Response.json({...clip,audio:alreadySaved});}});
  try{queue.add([clip]);for(let i=0;i<100&&!errors.length&&!calls.includes('GET');i++)await delay(5);await delay(25);return {calls,errors};}finally{queue.dispose();}
}
test('permanent validation and consent failures are not submitted to the decoder repeatedly',async()=>{
  for(const status of [400,403,404,409,413,415,422]){const r=await run(status);assert.deepEqual(r.calls,['POST','GET']);assert.equal(r.errors.length,1);assert.match(r.errors[0],/관객의 장면 기록은 저장/);}
});
test('a duplicate-upload conflict still confirms an already committed clip',async()=>{
  const r=await run(409,true);assert.deepEqual(r.calls,['POST','GET']);assert.deepEqual(r.errors,[]);
});
test('temporary decoder congestion keeps bounded retries and final confirmation',async()=>{
  const r=await run(429);assert.deepEqual(r.calls,['POST','GET','POST','GET','POST','GET']);assert.equal(r.errors.length,1);
});

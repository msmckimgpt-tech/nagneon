// File-only acceptance: feed a supplied synthetic WebM through the production
// delayed buffer, upload queue, HTTP route, disk persistence and range retrieval.
import assert from 'node:assert/strict';
import {mkdirSync,readFileSync,writeFileSync,readdirSync} from 'node:fs';
import {resolve,join} from 'node:path';
import {randomUUID,createHash} from 'node:crypto';
import {setTimeout as delay} from 'node:timers/promises';
import {ClipBuffer} from '../src/clip-buffer.ts';
import {ClipUploads} from '../src/clip-uploads.ts';
import {startServer} from '../server/index.js';

const [fixtureArg,outputArg]=process.argv.slice(2);if(!fixtureArg||!outputArg)throw Error('Usage: node scripts/verify-clip-transfer.mjs synthetic.webm output-directory');
const fixture=resolve(fixtureArg),output=resolve(outputArg),dataDir=join(output,'data');mkdirSync(output,{recursive:true});
if(readdirSync(output).length)throw Error('Use a new empty evidence directory.');
const bytes=readFileSync(fixture),hash=data=>createHash('sha256').update(data).digest('hex');
const provider={status:()=>({configured:true}),react:async()=>{throw Error('No model calls allowed in this file fixture.');}};
let service,buffer,uploads;const errors=[],transport=[];
const result={passed:false,fixture,sha256:hash(bytes),syntheticMedia:true,nativeCapture:false};
try{
  service=await startServer({port:0,dataDir,provider,localSpeech:false});
  const s=service.studio,sessionId=randomUUID(),now=Date.now();let time=now-105000,id=0;const timers=new Map();
  const clock={now:()=>time,set:(fn,ms)=>{timers.set(++id,{at:time+ms,fn});return id;},clear:id=>timers.delete(id)};
  const tick=ms=>{const end=time+ms;for(;;){const next=[...timers].filter(([,t])=>t.at<=end).sort((a,b)=>a[1].at-b[1].at)[0];if(!next)break;time=next[1].at;timers.delete(next[0]);next[1].fn();}time=end;};
  let segment=0;
  buffer=new ClipBuffer({sessionId,hasAudio:true,clock,onFailure:()=>{throw Error('buffer failed');},create:()=>{
    const first=segment++===0;
    return {state:'inactive',start(){this.state='recording';},stop(){this.state='inactive';this.ondataavailable?.({data:new Blob([first?bytes:Buffer.from('later scene')])});this.onstop?.();}};
  }});buffer.start();tick(105000);
  s.running=true;s.sessionId=sessionId;s.startedAt=now-120000;s.settings.autoHighlights=true;s.settings.clipBufferEnabled=true;
  const clip=s.clips.create({title:'Synthetic delayed pick',game:'File fixture',scene:'Synthetic color and tones',participants:[{id:'fixture',name:'Fixture viewer'}],messages:[],sessionId,source:'spectator',creator:{id:'fixture',name:'Fixture viewer',reason:'Synthetic test'},startedAt:s.startedAt,observedAt:now-100000});
  let lost=false,confirmed=false;
  const request=async(path,init={})=>{
    transport.push(init.method||'GET');
    const res=await fetch(service.url+path,{...init,headers:{...init.headers,Authorization:'Bearer '+service.accessToken}});
    if(init.method==='POST'&&!lost){lost=true;assert.equal(res.status,200);await res.arrayBuffer();throw Error('Injected lost response AFTER the real server committed');}
    if(!init.method){const saved=await res.clone().json();confirmed=saved.id===clip.id&&saved.video===true;}
    return res;
  };
  uploads=new ClipUploads({sessionId,takeAt:at=>buffer.takeAt(at),allowed:()=>s.running,onError:m=>errors.push(m),request,retryDelays:[5,5]});
  uploads.add([clip]);uploads.add([clip]);
  for(let i=0;i<200&&!confirmed;i++)await delay(10);
  assert.ok(confirmed);assert.deepEqual(transport,['POST','GET']);assert.deepEqual(errors,[]);
  const path=`/api/clips/${clip.id}/media/video`,headers={Authorization:'Bearer '+service.accessToken};
  const retrieved=await fetch(service.url+path,{headers});assert.equal(retrieved.status,200);assert.equal(hash(Buffer.from(await retrieved.arrayBuffer())),hash(bytes));
  const ranged=await fetch(service.url+path,{headers:{...headers,Range:'bytes=0-63'}});assert.equal(ranged.status,206);assert.deepEqual(Buffer.from(await ranged.arrayBuffer()),bytes.subarray(0,64));
  const saved=s.clips.get(clip.id);assert.equal(saved.videoStartedAt,now-105000);assert.equal(saved.videoEndedAt,now-90000);assert.equal(saved.hasAudio,true);
  assert.deepEqual(readdirSync(join(dataDir,'clip-media')),[clip.id+'.webm']);
  // Existing server consent and witness-time boundaries remain effective.
  const gates=[];
  const pending=s.clips.create({title:'Gate fixture',game:'File fixture',scene:'Synthetic scene',participants:[],messages:[],sessionId,source:'spectator',creator:clip.creator,observedAt:clip.observedAt});
  const send=async(start,end)=>{
    const query=new URLSearchParams({startedAt:String(start),endedAt:String(end),hasAudio:'true'});
    const r=await fetch(service.url+`/api/clips/${pending.id}/video?${query}`,{method:'POST',headers:{...headers,'X-Backseat-Client':'studio','Content-Type':'video/webm'},body:bytes});await r.arrayBuffer();return r.status;
  };
  s.settings.clipBufferEnabled=false;gates.push(await send(saved.videoStartedAt,saved.videoEndedAt));s.settings.clipBufferEnabled=true;
  s.settings.autoHighlights=false;gates.push(await send(saved.videoStartedAt,saved.videoEndedAt));s.settings.autoHighlights=true;
  s.sessionId=randomUUID();gates.push(await send(saved.videoStartedAt,saved.videoEndedAt));s.sessionId=sessionId;
  gates.push(await send(now-80000,now-65000));
  assert.deepEqual(gates,[409,409,409,409]);assert.equal(s.clips.get(pending.id).video,false);assert.deepEqual(readdirSync(join(dataDir,'clip-media')),[clip.id+'.webm']);
  uploads.dispose();buffer.dispose();await service.close();service=null;
  service=await startServer({port:0,dataDir,provider,localSpeech:false});
  assert.equal(service.studio.clips.get(clip.id).video,true);
  const reloaded=await fetch(service.url+path,{headers:{Authorization:'Bearer '+service.accessToken}});assert.equal(hash(Buffer.from(await reloaded.arrayBuffer())),hash(bytes));
  result.passed=true;Object.assign(result,{clipId:clip.id,transport,errors,mediaBytes:bytes.length,rangeStatus:206,reloaded:true,permissionAndMomentGates:gates,observedAt:clip.observedAt,videoStartedAt:saved.videoStartedAt,videoEndedAt:saved.videoEndedAt});
}catch(error){result.error=error.stack;throw error;}
finally{uploads?.dispose();buffer?.dispose();await service?.close();writeFileSync(join(output,'result.json'),JSON.stringify(result,null,2));}
console.log(JSON.stringify(result,null,2));

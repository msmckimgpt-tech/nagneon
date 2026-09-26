import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {readFileSync,writeFileSync,existsSync} from 'node:fs';
import {TemporalFrames,pixelChange} from '../src/temporal-frames.ts';
import {startTemporalCapture} from '../src/temporal-capture.ts';
import {Frame} from '../server/schema.js';
import {temporalVideo} from '../server/temporal-video.js';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {CodexProvider} from '../server/codex-provider.js';
import {defaults} from '../shared/defaults.js';
import {startServer} from '../server/index.js';

const img=text=>'data:image/png;base64,'+Buffer.from(text).toString('base64');
const a=img('standing'),b=img('jumping'),c=img('falling');
const observation={game:'Synthetic',scene:'움직였다가 돌아온 장면',confidence:.9,excitement:.5,messages:[{personaId:'pop',text:'오 돌아왔다',kind:'chat',spoiler:false}]};
function fixture(t,react){
  let at=100000;const requests=[];
  const s=new Studio({settings:{...defaults,mode:'live',intervalSeconds:5,lurkRatio:0,slowModeSeconds:0},audience:new Audience(undefined,()=>{},()=>.5),random:()=>.5,now:()=>at,
    provider:{status:()=>({configured:true}),react:async(args,signal)=>{requests.push(args);return react?react(args,signal):{observation};}}});
  clearInterval(s.timer);s.start();t.after(()=>s.close());const sourceId=randomUUID();
  return {s,requests,advance:ms=>at+=ms,now:()=>at,window:(images=[a,b,a],times)=>({sessionId:s.sessionId,sourceId,frames:images.map((image,i)=>({image,at:times?.[i]??at-(images.length-1-i)*500}))})};
}

test('bounded capture retains intermediate action while a model is busy, then acknowledges only that request',()=>{
  const ring=new TemporalFrames();ring.reset(randomUUID(),randomUUID());
  for(let i=0;i<12;i++)ring.add(i===6?b:a,100000+i*500,i===6||i===7?.8:0);
  const first=ring.window(105500);assert.ok(first.frames.some(f=>f.image===b));assert.equal(first.frames[0].at,100000);assert.equal(first.frames.at(-1).at,105500);assert.ok(first.frames.length<=8);
  for(let i=12;i<30;i++)ring.add(c,100000+i*500,.1);
  ring.acknowledge(first);const second=ring.window(114500);assert.equal(second.frames[0].at,105500);assert.equal(second.frames.at(-1).at,114500);
  assert.equal(second.frames.some(f=>f.image===b),false,'an accepted earlier jump is not replayed');
  ring.reset(randomUUID(),randomUUID());ring.add(a,200000);ring.acknowledge(first);assert.equal(ring.through,0);assert.equal(ring.samples.length,1);
  for(let i=1;i<1000;i++)ring.add('x'.repeat(319000),200000+i*500);assert.ok(ring.samples.length<=33);assert.ok(ring.samples.reduce((n,f)=>n+f.image.length,0)<=6400000);
  assert.equal(ring.window(9999999),undefined);
});

test('sampler is independent of inference, ignores frozen playback and stops after source changes',async()=>{
  let at=100000,tick,disposed=false,serial=0;const ring=new TemporalFrames();ring.reset('session','source');
  const video={videoWidth:3840,videoHeight:2160,readyState:2,currentTime:1,paused:false,ended:false};
  const canvases=[];const canvas=()=>{const value={width:0,height:0,getContext:()=>({drawImage:()=>{},getImageData:()=>({data:new Uint8ClampedArray(32*18*4).fill(serial++)})}),toDataURL:()=>a};canvases.push(value);return value;};
  const stop=startTemporalCapture(video,ring,e=>{throw e;},{now:()=>at,canvas,encode:async()=>a,schedule:fn=>{tick=fn;return 1;},cancel:()=>disposed=true});
  await new Promise(resolve=>setImmediate(resolve));
  assert.equal(ring.samples.length,1);assert.equal(canvases[0].width,960);assert.equal(canvases[0].height,540);
  for(let i=0;i<10;i++){at+=500;video.currentTime+=.5;tick();await new Promise(resolve=>setImmediate(resolve));}assert.equal(ring.samples.length,11);
  at+=3000;tick();assert.equal(ring.window(at),undefined,'a stuck decoder must not receive fresh wall timestamps');
  ring.reset();video.currentTime+=1;tick();assert.equal(ring.samples.length,0);stop();assert.equal(disposed,true);assert.equal(canvases[0].width,0);
  assert.equal(pixelChange(new Uint8ClampedArray([0,0,0,255]),new Uint8ClampedArray([255,255,255,255])),1);
});

test('wire schema rejects oversized, reversed, ambiguous and cross-window inputs within the existing body limit',()=>{
  const video={sessionId:randomUUID(),sourceId:randomUUID(),frames:[{image:a,at:1000},{image:b,at:1500}]};
  assert.equal(Frame.parse({video}).video.frames.length,2);
  for(const invalid of [{...video,frames:[...video.frames].reverse()},{...video,frames:[video.frames[0],{image:b,at:18000}]},{...video,frames:Array(9).fill(video.frames[0])},{...video,frames:[{image:img('x'.repeat(320000)),at:1000}]}])assert.equal(Frame.safeParse({video:invalid}).success,false);
  assert.equal(Frame.safeParse({video,image:a}).success,false);
  const max={video:{...video,frames:Array.from({length:8},(_,i)=>({image:img('x'.repeat(239000)),at:1000+i*500}))}};assert.ok(Frame.safeParse(max).success);assert.ok(Buffer.byteLength(JSON.stringify(max))<3*1024*1024);
});

test('server cuts frames before the latest viewer entry and marks overlap, source changes and gaps',()=>{
  const sessionId=randomUUID(),sourceId=randomUUID(),video={sessionId,sourceId,frames:[{at:1000,image:a},{at:2000,image:b},{at:3000,image:c}]};
  const options={now:3000,sessionId,startedAt:1000,joinedAt:[1000,2500]};
  const current=temporalVideo(video,options);assert.deepEqual(current.frames,[video.frames[2]]);
  const overlap=temporalVideo(video,{...options,joinedAt:[],previous:{sourceId,through:2000}});assert.deepEqual(overlap.timeline.frames.map(f=>f.alreadyObserved),[true,true,false]);assert.equal(overlap.timeline.gapBeforeMs,0);
  const switched=temporalVideo(video,{...options,previous:{sourceId:'other',through:2000}});assert.equal(switched.timeline.sourceChanged,true);
  assert.equal(temporalVideo(video,{...options,now:20000}).frames.length,0);
  assert.throws(()=>temporalVideo(video,{...options,sessionId:randomUUID()}),/끝난 방송/);assert.throws(()=>temporalVideo(video,{...options,now:1000}),/시각/);
  assert.equal(temporalVideo(video,{...options,previous:{sourceId,through:3500}}).ignored,'older-window');
});

test('A-B-A wakes the model despite matching endpoints and does not replay acknowledged motion',async t=>{
  const f=fixture(t);await f.s.react({video:f.window([a],[f.now()])});f.advance(6000);
  const video=f.window();await f.s.react({video});assert.equal(f.requests.length,2);assert.deepEqual(f.requests[1].frames.map(f=>f.image),[a,b,a]);
  assert.equal(f.requests[1].screenTimeline.frames.at(-1).ageMs,0);
  assert.equal(f.requests[1].viewerContext.pop.watchTiming.sameImageAsPreviousSample,false);assert.equal(f.requests[1].viewerContext.pop.watchTiming.imageUnchangedSeconds,0);
  f.advance(6000);assert.equal((await f.s.react({video:f.window([a])})).skipped,'unchanged-input');assert.equal(f.requests.length,2);
  assert.equal(f.s.viewing.last.video.through,f.now());
});

test('exact static spans send only the newest image with the full sampled still interval',()=>{
  const ring=new TemporalFrames();ring.reset(randomUUID(),randomUUID());for(let i=0;i<33;i++)ring.add(a,100000+i*500);
  const video=ring.window(116000);
  assert.deepEqual(video.frames,[{image:a,at:116000,still:{since:100000,samples:33}}]);
  assert.equal(Frame.safeParse({video}).success,true);
  assert.equal(ring.window(118501),undefined,'deduplication never refreshes an old capture');
});

test('static compaction keeps speech snapshots and acknowledged boundaries independent',()=>{
  const ring=new TemporalFrames();ring.reset(randomUUID(),randomUUID());for(let i=0;i<5;i++)ring.add(a,100000+i*500);
  const speech=ring.speechWindow(100500,102000),first=ring.window(102000);
  assert.deepEqual(speech.frames.map(f=>f.at),[100000,101000,102000]);
  ring.acknowledge(first);ring.add(a,102500);ring.add(a,103000);
  assert.deepEqual(ring.window(103000).frames,[{image:a,at:103000,still:{since:102000,samples:3}}]);
  assert.deepEqual(ring.speechWindow(100500,102000),speech);
  ring.reset(randomUUID(),randomUUID());ring.add(a,200000);
  assert.deepEqual(ring.window(200000).frames,[{image:a,at:200000}]);
  ring.acknowledge(first);assert.equal(ring.through,0);
});

test('static compaction does not grant late viewers evidence from before their entry',()=>{
  const sessionId=randomUUID(),sourceId=randomUUID(),ring=new TemporalFrames();ring.reset(sessionId,sourceId);
  ring.add(a,100000);ring.add(a,100500);ring.add(a,101000);
  const video=ring.window(101000),visible=temporalVideo(video,{now:101000,sessionId,startedAt:100000,joinedAt:[100750]});
  assert.deepEqual(visible.frames.map(f=>f.at),[101000]);
  assert.equal(visible.timeline.frames[0].still,undefined);
});

test('matching endpoints never hide a brief intermediate change in a pending window',()=>{
  const ring=new TemporalFrames();ring.reset(randomUUID(),randomUUID());
  ring.add(a,100000);ring.add(b,100500);ring.add(a,101000);
  assert.deepEqual(ring.window(101000).frames.map(f=>f.image),[a,b,a]);
  ring.reset(randomUUID(),randomUUID());for(let i=0;i<33;i++)ring.add(img(String(i)),100000+i*500,i===17?.006:0);
  const frames=ring.window(116000).frames;assert.ok(frames.some(f=>f.at===108000));assert.ok(frames.some(f=>f.at===108500));assert.equal(frames.length,8);
});

test('late viewers receive no pre-entry action through shared image attachments or game memory',async t=>{
  const f=fixture(t);f.advance(6000);f.s.audience.data.members.pop.joinedAt=f.now()-250;
  await f.s.react({video:f.window()});assert.equal(f.requests[0].frames.length,1);assert.equal(f.requests[0].frames[0].image,a);
  assert.equal(f.requests[0].screenTimeline.frames.length,1);
});

test('timestamped sound and captured speech remain alongside ordered frames',async t=>{
  const f=fixture(t);f.advance(6000);const at=f.now();f.s.sound.events=[{id:'sound',startedAt:at-500,endedAt:at,silent:false,witnesses:['pop'],classes:[],systemSpeech:'착지'}];
  f.s.receiveSpeech({id:randomUUID(),sessionId:f.s.sessionId,text:'방금 뭐였지?',source:'microphone',capture:{startedAt:at-1000,endedAt:at-500}});
  await f.s.react({video:f.window()});const input=f.requests[0];assert.equal(input.liveSpeech[0].capture.startedAt,at-1000);assert.equal(input.viewerContext.pop.heardSounds[0].endedAt,at);assert.equal(input.frames.length,3);
});

test('obsolete sequence replies cannot create delayed cheers, rewards or clips',async t=>{
  let release;const f=fixture(t,()=>new Promise(r=>release=r));f.advance(6000);const request=f.s.react({video:f.window()});f.advance(21000);release({observation:{...observation,positiveMoment:{positive:true,impact:1,reason:'착지',signature:'land',supporters:['pop'],donations:[]}}});
  assert.equal((await request).skipped,'stale-screen');assert.equal(f.s.queue.length,0);assert.equal(f.s.observation,null);assert.equal(f.s.clips.list().length,0);assert.equal(f.s.messages.filter(m=>m.kind==='donation').length,0);
});

test('disconnect cancels only that source, retains speech for retry and revokes late uploads',async t=>{
  let release;const f=fixture(t,()=>new Promise(r=>release=r));f.advance(6000);const video=f.window();f.s.receiveSpeech({id:randomUUID(),sessionId:f.s.sessionId,text:'방금 어떻게 된 거예요?'});
  const request=f.s.react({video});f.s.endVideo({sessionId:f.s.sessionId,sourceId:'unrelated'});assert.equal(f.s.liveReaction.superseded,false);
  f.s.endVideo(video);assert.equal(f.s.liveReaction.controller.signal.aborted,true);release({observation});assert.equal((await request).skipped,'superseded');assert.equal(f.s.queue.length,0);assert.equal(f.s.speechInbox.pending.length,1);
  assert.equal((await f.s.react({video})).skipped,'ended-screen');assert.equal(f.requests.length,1);
});

test('disconnect clears queued reactions and observation without interrupting Just Chatting',async t=>{
  const f=fixture(t);f.advance(6000);const video=f.window();await f.s.react({video});assert.ok(f.s.queue.length);f.s.endVideo(video);assert.equal(f.s.queue.length,0);assert.equal(f.s.observation,null);
  f.advance(6000);await f.s.react({speech:'화면은 끄고 이야기하죠.'});assert.equal(f.requests.at(-1).image,undefined);assert.equal(f.requests.at(-1).frames.length,0);
});

test('Codex CLI receives every image in order with matching timeline and cleans all temp images',async()=>{
  let dir,received;const provider=new CodexProvider({},(_bin,args,options)=>{
    dir=options.cwd;const paths=args.flatMap((arg,i)=>arg==='--image'?[args[i+1]]:[]);assert.equal(paths.length,3);assert.deepEqual(paths.map(p=>readFileSync(p,'utf8')),['standing','jumping','standing']);
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();child.kill=()=>true;
    let text='';child.stdin.on('data',b=>text+=b);child.stdin.on('finish',()=>{received=JSON.parse(text);writeFileSync(args[args.indexOf('--output-last-message')+1],JSON.stringify(observation));child.emit('close',0);});return child;
  });provider.available=true;
  const screenTimeline={frames:[{index:1,capturedAt:1000},{index:2,capturedAt:1500},{index:3,capturedAt:2000}]};
  await provider.react({settings:defaults,history:[],speech:'',image:a,frames:[{image:a},{image:b},{image:a}],screenTimeline},new AbortController().signal);
  assert.deepEqual(received.screenTimeline,screenTimeline);assert.equal(received.hasImage,true);assert.equal(existsSync(dir),false);
});

test('HTTP react accepts eight frames below 3MB and viewing-end invalidates the exact source',async t=>{
  let input;const app=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true}),react:async args=>{input=args;return {observation};}}});t.after(()=>app.close());
  app.studio.settings={...app.studio.settings,mode:'live',intervalSeconds:5};app.studio.start();app.studio.autonomy=null;
  const at=Date.now();app.studio.startedAt=at-10000;for(const m of Object.values(app.studio.audience.data.members))m.joinedAt=at-10000;
  const post=(path,body,headers={})=>fetch(app.url+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio',Authorization:'Bearer '+app.accessToken,...headers},body:JSON.stringify(body)});
  const video={sessionId:app.studio.sessionId,sourceId:randomUUID(),frames:Array.from({length:8},(_,i)=>({at:at-3500+i*500,image:img('x'.repeat(239000))}))};
  let response=await post('react',{video});assert.equal(response.status,200);assert.equal((await response.json()).ok,true);assert.equal(input.frames.length,8);
  response=await post('viewing-end',video);assert.equal(response.status,200);assert.ok(app.studio.endedVideoSources.has(video.sourceId));
  response=await post('react',{video});assert.equal((await response.json()).skipped,'ended-screen');
});

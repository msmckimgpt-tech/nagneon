import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtempSync,rmSync,existsSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {setTimeout as delay} from 'node:timers/promises';
import {createClipSource} from '../src/clip-source.ts';
import {ClipBuffer} from '../src/clip-buffer.ts';
import {ClipUploads} from '../src/clip-uploads.ts';
import {Clips,ClipFeatures} from '../server/clips.js';
import {ClipsData} from '../server/data-schema.js';
import {defaults} from '../shared/defaults.js';

function track(kind,readyState='live'){return {kind,readyState,stops:0,clones:[],stop(){this.stops++;this.readyState='ended';},clone(){const t=track(kind);this.clones.push(t);return t;}};}
const stream=(tracks=[])=>({getTracks:()=>tracks,getVideoTracks:()=>tracks.filter(t=>t.kind==='video'),getAudioTracks:()=>tracks.filter(t=>t.kind==='audio')});
function sourceHarness(){let closes=0,seen=[],checked=[];const mixed=track('audio');return {options:{supported:m=>{checked.push(m);return true;},makeStream:stream,mix:sources=>{seen=sources;return {tracks:sources.length?[mixed]:[],close:()=>{closes++;mixed.stop();}};}},seen:()=>seen,closes:()=>closes,checked};}
const T=1_000_000;
const base={title:'잡담',game:'Just Chatting',participants:[],messages:[],sessionId:'a',scene:'함께 웃음'};
const bytes=Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.alloc(120)]);

test('microphone alone creates Opus audio without constructing a picture track',()=>{
  const h=sourceHarness(),mic=stream([track('audio')]);const source=createClipSource(null,mic,null,h.options);
  assert.equal(source.kind,'audio');assert.equal(source.hasAudio,true);assert.equal(source.mimeType,'audio/webm;codecs=opus');assert.equal(source.stream.getVideoTracks().length,0);assert.equal(source.recorderOptions.videoBitsPerSecond,undefined);assert.deepEqual(h.seen(),[mic]);source.close();source.close();assert.equal(h.closes(),1);assert.equal(mic.getAudioTracks()[0].stops,0);
});
test('sound-only display stream never exposes or clones its unshared video track',()=>{
  const h=sourceHarness(),video=track('video'),sound=stream([video,track('audio')]);sound.getVideoTracks=()=>{throw Error('unshared picture was accessed');};
  const source=createClipSource(null,null,sound,h.options);assert.equal(source.kind,'audio');assert.equal(source.stream.getTracks().length,1);assert.equal(video.clones.length,0);source.close();assert.equal(video.stops,0);
});
test('shared picture plus sound remains a video clip and closes only owned clones',()=>{
  const h=sourceHarness(),v=track('video'),picture=stream([v]),mic=stream([track('audio')]),sound=stream([track('audio')]);
  const source=createClipSource(picture,mic,sound,h.options);assert.equal(source.kind,'video');assert.equal(source.stream.getVideoTracks()[0],v.clones[0]);assert.equal(source.stream.getAudioTracks().length,1);assert.deepEqual(h.seen(),[sound,mic]);source.close();assert.equal(v.stops,0);assert.equal(v.clones[0].stops,1);
});
test('unconnected or ended sources create neither a mixer nor a recorder',()=>{
  const h=sourceHarness();assert.equal(createClipSource(null,null,null,h.options),null);assert.equal(createClipSource(stream([track('video','ended')]),stream([track('audio','ended')]),null,h.options),null);assert.deepEqual(h.checked,[]);assert.deepEqual(h.seen(),[]);
});
test('unsupported audio codec and source construction failure release resources',()=>{
  const h=sourceHarness(),mic=stream([track('audio')]);assert.equal(createClipSource(null,mic,null,{...h.options,supported:()=>false}),null);assert.deepEqual(h.seen(),[]);
  const v=track('video');assert.throws(()=>createClipSource(stream([v]),mic,null,{...h.options,makeStream:()=>{throw Error('stream failure');}}),/stream failure/);assert.equal(v.clones[0].stops,1);assert.equal(v.stops,0);assert.equal(h.closes(),1);
});
test('audio segments retain their kind, MIME and session through the shared buffer',async()=>{
  let now=T,rec;const b=new ClipBuffer({sessionId:'a',kind:'audio',hasAudio:true,clock:{now:()=>now,set:setTimeout,clear:clearTimeout},onFailure:()=>assert.fail(),create:()=>rec={state:'inactive',start(){this.state='recording';},stop(){this.state='inactive';}}});b.start();now+=15000;rec.ondataavailable({data:new Blob([bytes])});rec.onstop();const value=await b.takeAt(T+1000);b.dispose();assert.equal(value.kind,'audio');assert.equal(value.blob.type,'audio/webm');assert.equal(value.sessionId,'a');assert.deepEqual(Buffer.from(await value.blob.arrayBuffer()),bytes);
});
test('audio attachment is exclusive, persisted, schema-valid and removed with its clip',()=>{
  const dir=mkdtempSync(join(tmpdir(),'backseat-audio-'));
  try{const clips=new Clips({dir,now:()=>T});const clip=clips.create(base),meta={kind:'audio',hasAudio:true,startedAt:T-15000,endedAt:T};
    const saved=clips.recording(clip.id,bytes,meta);assert.equal(saved.audio,true);assert.equal(saved.video,false);assert.equal(saved.audioStartedAt,T-15000);assert.equal(ClipsData.parse(clips.data)[0].audio,true);
    assert.throws(()=>clips.video(clip.id,bytes,meta),/이미 음성/);assert.ok(existsSync(clips.file(clip.id,'webm')));
    clips.comment(clip.id,{text:'이 웃음 다시 들으러 옴',name:'viewer'});assert.equal(clips.list()[0].commentCount,1);clips.remove(clip.id);assert.equal(existsSync(clips.file(clip.id,'webm')),false);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('failed audio metadata save rolls back file and audio flag; no-audio claim is rejected',()=>{
  const dir=mkdtempSync(join(tmpdir(),'backseat-audio-rollback-'));let fail=false;
  try{const clips=new Clips({dir,now:()=>T,save:()=>{if(fail)throw Error('disk error');}}),clip=clips.create(base),meta={kind:'audio',hasAudio:true,startedAt:T-15000,endedAt:T};fail=true;
    assert.throws(()=>clips.recording(clip.id,bytes,meta),/disk error/);assert.equal(clips.get(clip.id).audio,false);assert.equal(existsSync(clips.file(clip.id,'webm')),false);
    fail=false;assert.throws(()=>clips.recording(clip.id,bytes,{...meta,hasAudio:false}),/소리 트랙/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('legacy video metadata loads, while conflicting or incomplete audio metadata is rejected',()=>{
  const clips=new Clips({now:()=>T}),clip=clips.create(base);delete clip.audio;clip.video=true;assert.equal(ClipsData.parse([clip])[0].audio,false);
  const audio={...clip,video:false,audio:true,hasAudio:true,audioStartedAt:T-15000,audioEndedAt:T};assert.equal(ClipsData.parse([audio])[0].audio,true);
  for(const bad of [{...audio,video:true},{...audio,hasAudio:false},{...audio,audioEndedAt:undefined},{...audio,audioEndedAt:T-16000}])assert.throws(()=>ClipsData.parse([bad]));
});
test('audio upload uses the audio endpoint and confirms a lost success without another POST',async()=>{
  const calls=[],errors=[],clip={id:'audio-clip',source:'spectator',sessionId:'a',video:false,audio:false,audioEligible:true,createdAt:T,observedAt:T-1000};
  const q=new ClipUploads({sessionId:'a',now:()=>T,allowed:()=>true,onError:e=>errors.push(e),retryDelays:[0,0],takeAt:async()=>({kind:'audio',sessionId:'a',blob:new Blob([bytes],{type:'audio/webm'}),hasAudio:true,startedAt:T-15000,endedAt:T}),request:async(path,init)=>{calls.push({path,method:init.method,content:init.headers['Content-Type']});if(init.method)throw Error('lost');return Response.json({...clip,audio:true});}});
  try{q.add([clip]);for(let i=0;i<100&&calls.length<2;i++)await delay(5);await delay(10);assert.equal(calls.length,2);assert.match(calls[0].path,/\/audio\?/);assert.equal(calls[0].content,'audio/webm');assert.equal(calls[1].method,undefined);assert.deepEqual(errors,[]);q.add([{...clip,audio:true}]);await delay(10);assert.equal(calls.length,2);}finally{q.dispose();}
});
test('unvoiced text-only picks do not attach unrelated audio from the active microphone',async()=>{
  let requests=0;
  const q=new ClipUploads({sessionId:'a',now:()=>T,allowed:()=>true,onError:()=>assert.fail(),takeAt:async()=>({kind:'audio',sessionId:'a',blob:new Blob([bytes]),hasAudio:true,startedAt:T-15000,endedAt:T}),request:async()=>{requests++;return Response.json({});}});
  q.add([{id:'typed',source:'spectator',sessionId:'a',video:false,createdAt:T}]);await delay(10);q.dispose();assert.equal(requests,0);
});

function pickFixture(){const p=defaults.personas.find(p=>!p.system),clips=new Clips({now:()=>T});const studio={settings:{...defaults,mode:'live',autoHighlights:true,personas:[p],managerId:'system'},running:true,sessionId:'a',startedAt:T-100000,now:()=>T,messages:[],log(){},publish(){}};return {p,clips,feature:new ClipFeatures(studio,clips),observation:{game:'Just Chatting',scene:'짧은 웃음 소리',confidence:.1,clipPicks:[{personaId:p.id,title:'웃음이 터진 순간',reason:'전염되는 웃음',signature:'laugh',soundId:'heard-1'}]},event:{id:'heard-1',source:'system-output',startedAt:T-8000,endedAt:T-4000,silent:false}};}
test('audio-only favorite uses the chosen heard event time and does not invent a screenshot',()=>{
  const f=pickFixture(),[clip]=f.feature.spectatorPicks(f.observation,{witnesses:[f.p.id],capturedAt:T,heardByViewer:{[f.p.id]:[f.event]}});assert.ok(clip);assert.equal(clip.observedAt,T-6000);assert.equal(clip.thumbnail,null);assert.equal(clip.source,'spectator');assert.equal(clip.creator.id,f.p.id);
});
test('unheard, silent, stale and future sounds cannot authorize an audio-only favorite',()=>{
  for(const event of [null,{silent:true},{endedAt:T-30001,startedAt:T-32000},{endedAt:T+1},{id:'other'}]){
    const f=pickFixture(),events=event?[{...f.event,...event}]:[];
    assert.deepEqual(f.feature.spectatorPicks(f.observation,{witnesses:[f.p.id],capturedAt:T,heardByViewer:{[f.p.id]:events}}),[]);
  }
});
test('an unreferenced sound or another viewer sound never substitutes for the pick source',()=>{
  const f=pickFixture();f.observation.clipPicks[0].soundId='';assert.deepEqual(f.feature.spectatorPicks(f.observation,{witnesses:[f.p.id],capturedAt:T,heardByViewer:{[f.p.id]:[f.event]}}),[]);
  f.observation.clipPicks[0].soundId='heard-1';assert.deepEqual(f.feature.spectatorPicks(f.observation,{witnesses:[f.p.id],capturedAt:T,heardByViewer:{other:[f.event]}}),[]);
});

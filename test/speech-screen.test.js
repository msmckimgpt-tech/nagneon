import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {TemporalFrames} from '../src/temporal-frames.ts';
import {SpeechOutbox,SpeechQueue,recognizeWithRecovery} from '../src/speech-flow.ts';
import {SpeechInbox} from '../server/speech-inbox.js';
import {SpeechCapture,witnessedSpeech,speechAttachments} from '../server/speech-screen.js';
import {OpenAIProvider} from '../server/provider.js';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {defaults} from '../shared/defaults.js';

const img=s=>'data:image/png;base64,'+Buffer.from(s).toString('base64');
const old=img('old scene'),current=img('new scene'),T=100000;

test('continuous microphone backlog retains active and newest audio without stopping the queue',async()=>{
  let release;const seen=[],results=[];const q=new SpeechQueue({execute:async v=>{seen.push(v);if(v===0)await new Promise(r=>release=r);return v;},onResult:v=>results.push(v),onError:()=>assert.fail()});
  q.enqueueLatest(0);for(let i=1;i<=8;i++)assert.equal(q.enqueueLatest(i),undefined);
  assert.equal(q.enqueueLatest(9),1);assert.equal(q.running,true);release();await new Promise(r=>setImmediate(r));
  assert.deepEqual(seen,[0,2,3,4,5,6,7,8,9]);assert.deepEqual(results,seen);
});

test('recognizer recovery retries the same job once, and cancellation prevents a retry',async()=>{
  const c=new AbortController();let calls=0,prepares=0;
  const request=async()=>{if(++calls===1)throw Object.assign(Error('prepare'),{needsPreparation:true});return 'same audio';};
  assert.equal(await recognizeWithRecovery(request,async()=>prepares++,c.signal),'same audio');assert.equal(prepares,1);assert.equal(calls,2);
  calls=0;await assert.rejects(recognizeWithRecovery(request,async()=>c.abort(),c.signal),/취소/);assert.equal(calls,1);
});
function fixture(){const ring=new TemporalFrames();ring.reset(randomUUID(),randomUUID());for(let at=T;at<=T+2000;at+=500)ring.add(old,at);return {ring,capture:{startedAt:T+500,endedAt:T+2000,screen:ring.speechWindow(T+500,T+2000)}};}

test('snapshot survives visual acknowledgement, scene changes, eviction and STT transport retry',async()=>{
  const {ring,capture}=fixture();ring.acknowledge(ring.window(T+2000));
  assert.deepEqual(ring.speechWindow(capture.startedAt,capture.endedAt),capture.screen);
  const box=new SpeechOutbox();box.add('이거 봐',ring.sessionId,'microphone',capture);
  capture.screen.frames[0].image=current;
  for(let at=T+2500;at<T+25000;at+=500)ring.add(current,at);
  let sent;await assert.rejects(box.flush(async item=>{sent=structuredClone(item);throw Error('lost');}));
  await box.flush(async item=>assert.deepEqual(item,sent));
  assert.equal(sent.capture.screen.frames[0].image,old);
  assert.equal(ring.window(T+24500).frames[0].image,current);
  assert.equal(ring.speechWindow(T+500,T+2000),undefined);
  ring.reset();assert.equal(sent.capture.screen.frames[0].image,old);
});

test('speech snapshots exclude post-utterance frames and reject stale samples',()=>{
  const {ring}=fixture();ring.add(current,T+2500);
  assert.ok(ring.speechWindow(T+500,T+2000).frames.every(f=>f.at<=T+2000&&f.image===old));
  assert.equal(ring.speechWindow(T+6000,T+7000),undefined);
});

test('inbox fingerprints pixels, preserves deep ownership and batches distinct capture times separately',()=>{
  const {capture}=fixture(),inbox=new SpeechInbox(),id=randomUUID();
  inbox.receive(id,'이거',()=>({id:'one'}),'microphone',capture,['momo']);
  const copy=structuredClone(capture);assert.equal(inbox.receive(id,'이거',()=>assert.fail(),'microphone',copy).duplicate,true);
  copy.screen.frames[0].image=current;assert.throws(()=>inbox.receive(id,'이거',()=>assert.fail(),'microphone',copy),/내용이 달라/);
  inbox.sources([id])[0].capture.screen.frames[0].image=current;assert.equal(inbox.sources([id])[0].capture.screen.frames[0].image,old);
  const next=randomUUID();inbox.receive(next,'저거',()=>({id:'two'}),'microphone',capture,['momo']);
  assert.deepEqual(inbox.batch().ids,[id]);inbox.acknowledge([id]);assert.deepEqual(inbox.batch().ids,[next]);inbox.clear();assert.equal(inbox.pending.length,0);
});

test('historical frame schema rejects future, unordered, oversized, extra and out of interval data',()=>{
  const {capture}=fixture();assert.equal(SpeechCapture.safeParse(capture).success,true);
  for(const change of [c=>c.screen.frames[0].at=c.endedAt+1,c=>c.screen.frames.reverse(),c=>c.screen.frames.push(c.screen.frames[0]),c=>c.screen.frames[0].image='data:image/png;base64,'+'A'.repeat(320000),c=>c.screen.extra='x']){
    const c=structuredClone(capture);change(c);assert.equal(SpeechCapture.safeParse(c).success,false);
  }
});

test('historical images are filtered for new viewers, ended sources, session and expiry without substituting current video',()=>{
  const {capture}=fixture(),source=[{messageId:'one',source:'microphone',capture}],options={sessionId:capture.screen.sessionId,now:T+30000};
  const filtered=witnessedSpeech(source,{...options,joinedAt:[T,T+1800]});
  assert.deepEqual(filtered[0].capture.screen.frames.map(f=>f.at),[T+2000]);
  for(const extra of [{joinedAt:[T+3000]},{endedSources:new Map([[capture.screen.sourceId,true]])},{sessionId:randomUUID()},{now:capture.endedAt+120001}]){
    const result=speechAttachments(witnessedSpeech(source,{...options,...extra}),8);assert.equal(result.images.length,0);assert.equal(result.liveSpeech[0].speechScreen.status,'unavailable');
  }
  assert.equal(speechAttachments(witnessedSpeech(source,{...options,now:capture.endedAt+120000})).images.length,3);
  assert.equal(source[0].capture.screen.frames.length,3);
});

test('provider orders speech-time evidence before current video and maps final attachment indexes',()=>{
  const {capture}=fixture();const p=new OpenAIProvider({}),screenTimeline={sourceId:'live',frames:[{index:1,capturedAt:T+30000}]};
  const payload=p.payload({settings:defaults,history:[],frames:[{image:current}],screenTimeline,speech:'이거',liveSpeech:[{messageId:'one',source:'microphone',capture}]});
  const content=payload.input[0].content,metadata=JSON.parse(content[0].text);
  assert.deepEqual(content.slice(1).map(entry=>entry.image_url),[old,old,old,current]);
  assert.deepEqual(metadata.liveSpeech[0].speechScreen.frames.map(f=>f.index),[1,2,3]);
  assert.deepEqual(metadata.screenTimeline.frames.map(f=>f.index),[4]);
  assert.equal(content[0].text.includes('data:image'),false);assert.equal(metadata.hasImage,true);
  assert.match(payload.instructions,/현재 화면으로 과거 대상을 바꾸지/);
  const historicalOnly=p.payload({settings:defaults,history:[],speech:'이거',liveSpeech:[{messageId:'one',source:'microphone',capture}]});
  assert.equal(JSON.parse(historicalOnly.input[0].content[0].text).hasImage,true);
  assert.equal(historicalOnly.input[0].content.length,4);
});

test('multiple speech captures map distinct images without mutating reusable live metadata',()=>{
  const {capture}=fixture(),p=new OpenAIProvider({});
  capture.screen.frames.forEach((f,i)=>{f.image=img('speech '+i);});
  const second=structuredClone(capture);second.screen.frames=[{image:img('second speech'),at:T+2500}];
  const liveSpeech=[{messageId:'one',source:'microphone',capture},{messageId:'two',source:'microphone',capture:second}];
  const frames=[{image:current},{image:img('latest live')}],screenTimeline={frames:[{index:1,capturedAt:T+30000},{index:2,capturedAt:T+31000}]};
  const args={settings:defaults,history:[],frames,screenTimeline,liveSpeech},before=structuredClone(args);
  for(let attempt=0;attempt<2;attempt++){
    const content=p.payload(args).input[0].content,metadata=JSON.parse(content[0].text);
    assert.deepEqual(content.slice(1).map(f=>f.image_url),[...capture.screen.frames.map(f=>f.image),second.screen.frames[0].image,...frames.map(f=>f.image)]);
    assert.deepEqual(metadata.liveSpeech.map(s=>s.speechScreen.frames.map(f=>f.index)),[[1,2,3],[4]]);
    assert.deepEqual(metadata.screenTimeline.frames.map(f=>f.index),[5,6]);
  }
  assert.deepEqual(args,before);
});

test('delayed speech reaches actual Studio provider with original scene while live viewing stays current',async t=>{
  let now=T;const inputs=[];const s=new Studio({settings:{...defaults,mode:'live',lurkRatio:0,intervalSeconds:5,communityActivityEnabled:false},now:()=>now,random:()=>.5,audience:new Audience(undefined,()=>{},()=>.5),provider:{status:()=>({configured:true}),react:async args=>{inputs.push(args);return {observation:{game:'Test',scene:'new scene',confidence:.5,excitement:0,messages:[]}};}}});
  clearInterval(s.timer);s.start();t.after(()=>s.close());const {capture}=fixture();capture.screen.sessionId=s.sessionId;
  now=T+30000;s.receiveSpeech({id:randomUUID(),sessionId:s.sessionId,text:'이거 보여?',source:'microphone',capture});
  assert.equal((await s.react({video:{sessionId:s.sessionId,sourceId:capture.screen.sourceId,frames:[{image:current,at:now}]}})).ok,true);
  assert.equal(inputs[0].image,current);assert.equal(inputs[0].liveSpeech[0].capture.screen.frames[0].image,old);
  assert.equal(s.viewing.last.video.through,now);assert.equal(JSON.stringify(s.state()).includes(old),false);
  assert.equal(s.speechInbox.pending.length,0);
});

test('ending a historical-only source cancels its inference and its tombstone outlives delayed audio',async t=>{
  let now=T,started;const entered=new Promise(r=>started=r);
  const s=new Studio({settings:{...defaults,mode:'live',lurkRatio:0,communityActivityEnabled:false},now:()=>now,random:()=>.5,audience:new Audience(undefined,()=>{},()=>.5),provider:{status:()=>({configured:true}),react:async(_args,signal)=>{started();return new Promise((_r,reject)=>signal.addEventListener('abort',()=>reject(Error('aborted')),{once:true}));}}});
  clearInterval(s.timer);s.start();t.after(()=>s.close());const {capture}=fixture();capture.screen.sessionId=s.sessionId;
  now=T+30000;s.receiveSpeech({id:randomUUID(),sessionId:s.sessionId,text:'이거',source:'microphone',capture});
  const pending=s.react({});await entered;s.endVideo({sessionId:s.sessionId,sourceId:capture.screen.sourceId});
  assert.equal((await pending).skipped,'superseded');assert.equal(s.speechInbox.pending.length,1);
  now+=61000;s.endVideo({sessionId:s.sessionId,sourceId:randomUUID()});assert.equal(s.endedVideoSources.has(capture.screen.sourceId),true);
  const sources=witnessedSpeech(s.speechInbox.sources(s.speechInbox.batch().ids),{sessionId:s.sessionId,now,endedSources:s.endedVideoSources});
  assert.equal(speechAttachments(sources).images.length,0);
});

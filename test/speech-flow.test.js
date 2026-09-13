import test from 'node:test';
import assert from 'node:assert/strict';
import {VoiceBoundary,SpeechQueue,SpeechMailbox} from '../src/speech-flow.ts';
import {Studio} from '../server/studio.js';
import {startServer} from '../server/index.js';
import {defaults} from '../shared/defaults.js';
const turn=()=>new Promise(r=>setImmediate(r));

test('short speech flushes after 650ms silence, instead of waiting six seconds',()=>{
  const b=new VoiceBoundary(0);for(let at=50;at<=1000;at+=50)assert.equal(b.sample(.08,at),null);for(let at=1050;at<1650;at+=50)assert.equal(b.sample(0,at),null);assert.equal(b.sample(0,1650),'speech-end');assert.equal(b.hasSpeech,true);
});
test('brief pauses stay in the same utterance and sustained speech ends at the length cap',()=>{
  const b=new VoiceBoundary(0);for(let at=50;at<=12000;at+=50){const pause=at>1500&&at<1850;assert.equal(b.sample(pause?0:.07,at),at===12000?'limit':null);}assert.equal(b.hasSpeech,true);
});
test('silence and a single noise spike never become a transcribed utterance',()=>{
  const b=new VoiceBoundary(0);for(let at=50;at<=3000;at+=50)assert.equal(b.sample(at===500?.1:0,at),at===3000?'idle':null);assert.equal(b.hasSpeech,false);
});
test('clock suspension does not count a large wall-time gap as long speech',()=>{const b=new VoiceBoundary(0);assert.equal(b.sample(1,50000),'limit');assert.equal(b.voicedMs,200);});
test('recognition queue preserves every segment in order while prior recognition is busy',async()=>{
  const pending=[],outputs=[],seen=[],q=new SpeechQueue({execute:(value)=>{seen.push(value);return new Promise(r=>pending.push(r));},onResult:r=>outputs.push(r),onError:e=>{throw e;}});
  assert.equal(q.enqueue('first'),true);q.enqueue('second');q.enqueue('third');assert.deepEqual(seen,['first']);pending.shift()('one');await turn();assert.deepEqual(seen,['first','second']);pending.shift()('two');await turn();pending.shift()('three');await turn();assert.deepEqual(outputs,['one','two','three']);assert.equal(q.running,false);
});
test('reset aborts pending recognition and discards its late output without losing a new generation',async()=>{
  const resolve=[],signals=[],outputs=[],q=new SpeechQueue({execute:(v,signal)=>{signals.push(signal);return new Promise(r=>resolve.push(r));},onResult:r=>outputs.push(r),onError:()=>assert.fail('stale error')});q.enqueue('old');q.enqueue('old waiting');q.reset();assert.equal(signals[0].aborted,true);q.enqueue('new');resolve[0]('late old');await turn();resolve[1]('new response');await turn();assert.deepEqual(outputs,['new response']);assert.equal(q.pending.length,0);
});
test('recognition errors do not block subsequent speech and backlog limits are explicit',async()=>{
  const errors=[],outputs=[];let release;const q=new SpeechQueue({execute:async v=>{if(v==='slow')return new Promise(r=>release=r);if(v==='broken')throw new Error('transcription failed');return v;},onResult:r=>outputs.push(r),onError:e=>errors.push(e.message)});q.enqueue('broken');q.enqueue('okay');await turn();assert.deepEqual(outputs,['okay']);assert.deepEqual(errors,['transcription failed']);q.enqueue('slow');for(let i=0;i<8;i++)assert.equal(q.enqueue(i),true);assert.equal(q.enqueue('overflow'),false);release('first');await turn();assert.deepEqual(outputs.slice(1),['first',0,1,2,3,4,5,6,7]);
});
test('acknowledging an in-flight prompt retains speech appended while the model is busy',()=>{
  const q=new SpeechMailbox();q.add('가'.repeat(2900));const first=q.batch();q.add('두 번째 발언');q.add('나'.repeat(3100));q.acknowledge(first.ids);assert.equal(q.batch().text,'두 번째 발언');q.acknowledge(q.batch().ids);assert.equal(q.batch().text.length,3000);q.acknowledge(q.batch().ids);assert.equal(q.batch().text.length,100);
});
test('speech mailbox rejects overflow without truncating older or newly accepted speech',()=>{
  const q=new SpeechMailbox();for(let i=0;i<40;i++)assert.equal(q.add('발언'+i),true);assert.equal(q.add('overflow'),false);assert.equal(q.items.length,40);assert.equal(q.items[0].text,'발언0');q.clear();assert.equal(q.batch().text,'');
});

test('emoji and mixed Korean speech drain within the wire limit without splitting surrogate pairs',()=>{
  const q=new SpeechMailbox(),value='안'+ '😀'.repeat(3100)+'끝';q.add(value);const received=[];
  while(q.items.length){const batch=q.batch();assert.ok(batch.text.length>0&&batch.text.length<=3000);assert.equal(batch.text.isWellFormed(),true);received.push(batch.text);q.acknowledge(batch.ids);}
  assert.equal(received.join(''),value);
});
test('cancelled microphone request cannot update voice cues and releases the studio audio lock',async()=>{
  let release;const s=new Studio({settings:{...defaults,mode:'live'},provider:{localSpeech:true,status:()=>({configured:true}),transcribe:(_buffer,_mime,signal)=>new Promise(r=>release=()=>r({text:'늦은 음성',cues:{delivery:'late',aborted:signal.aborted}}))}});s.start();const controller=new AbortController(),job=s.transcribe(Buffer.from('sample'),'audio/wav',controller.signal);controller.abort();release();assert.deepEqual(await job,{text:''});assert.equal(s.voiceCues,null);assert.equal(s.audioBusy,false);s.close();
});
test('aborting the HTTP audio request propagates cancellation to the recognizer',async()=>{
  let begun,aborted;const started=new Promise(r=>begun=r),cancelled=new Promise(r=>aborted=r);
  const service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true}),localSpeech:true,transcribe:(_b,_m,signal)=>new Promise((_resolve,reject)=>{begun();signal.addEventListener('abort',()=>{aborted();reject(new Error('cancelled'));},{once:true});})}});
  try{service.studio.configure({...service.studio.settings,mode:'live'});service.studio.start();const controller=new AbortController();const response=fetch(service.url+'/api/audio',{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'audio/wav'},body:Buffer.from('audio'),signal:controller.signal});await started;controller.abort();await assert.rejects(response,/abort/i);await Promise.race([cancelled,new Promise((_,reject)=>setTimeout(()=>reject(new Error('server did not cancel')),1500))]);await turn();assert.equal(service.studio.audioBusy,false);}finally{await service.close();}
});

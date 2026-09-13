import test from 'node:test';
import assert from 'node:assert/strict';
import {prepareCapture} from '../src/capture-preparation.ts';
const deferred=()=>{let resolve,reject;const promise=new Promise((a,b)=>{resolve=a;reject=b;});return {promise,resolve,reject};};
class Track extends EventTarget {readyState='live';stop(){this.readyState='ended';}end(){this.stop();this.dispatchEvent(new Event('ended'));}}
class Video extends EventTarget {srcObject=null;readyState=0;videoWidth=0;videoHeight=0;paused=false;playback=deferred();play(){return this.playback.promise;}pause(){this.paused=true;}frame(){this.readyState=2;this.videoWidth=640;this.videoHeight=360;this.dispatchEvent(new Event('loadeddata'));}}
const stream=(audio=false)=>{const v=new Track(),a=audio?new Track():null;return {getTracks:()=>[v,...(a?[a]:[])],getVideoTracks:()=>[v],getAudioTracks:()=>a?[a]:[]};};
const flush=async()=>{for(let i=0;i<5;i++)await Promise.resolve();};
test.beforeEach(t=>t.mock.timers.enable({apis:['setTimeout']}));
function fixture(t,options={}){
 const controller=new AbortController(),video=new Video(),acquisition=deferred(),phases=[];
 const pending=prepareCapture({acquire:()=>acquisition.promise,signal:controller.signal,createVideo:()=>video,onPhase:p=>phases.push(p),...options});
 return {controller,video,acquisition,phases,pending};
}
test('cancel before acquisition finishes settles immediately and releases a late screen and audio',async t=>{
 const f=fixture(t),rejection=assert.rejects(f.pending,{name:'AbortError'});f.controller.abort();await rejection;
 const s=stream(true);f.acquisition.resolve(s);await flush();assert.ok(s.getTracks().every(t=>t.readyState==='ended'));assert.equal(f.video.srcObject,null);
});
test('native acquisition deadline releases late tracks; browser chooser can wait for user choice',async t=>{
 const f=fixture(t),rejection=assert.rejects(f.pending,/선택한 화면에 연결하지 못했습니다/);t.mock.timers.tick(30000);await rejection;const s=stream();f.acquisition.resolve(s);await flush();assert.equal(s.getTracks()[0].readyState,'ended');
 const g=fixture(t,{acquisitionTimeoutMs:0});t.mock.timers.tick(60000);const success=stream();g.acquisition.resolve(success);await flush();g.video.frame();g.video.playback.resolve();assert.equal((await g.pending).stream,success);
});
test('playback alone is insufficient; decoded dimensions and active source are required',async t=>{
 const f=fixture(t),s=stream();f.acquisition.resolve(s);await flush();f.video.playback.resolve();await flush();let resolved=false;f.pending.then(()=>resolved=true);await flush();assert.equal(resolved,false);
 f.video.frame();const result=await f.pending;assert.equal(result.stream,s);assert.equal(result.video,f.video);assert.deepEqual(f.phases,['source','frame']);
 f.controller.abort();assert.equal(s.getTracks()[0].readyState,'live','completed stream ownership belongs to caller');
});
test('frame deadline stops all candidate tracks and detaches video even with unresolved play',async t=>{
 const f=fixture(t),s=stream(true),rejection=assert.rejects(f.pending,/첫 화면을 15초/);f.acquisition.resolve(s);await flush();t.mock.timers.tick(15000);await rejection;
 assert.ok(s.getTracks().every(t=>t.readyState==='ended'));assert.equal(f.video.srcObject,null);assert.equal(f.video.paused,true);f.video.playback.resolve();await flush();assert.equal(f.video.srcObject,null);
});
test('source closure while play is pending rejects immediately and removes event listeners',async t=>{
 const f=fixture(t),s=stream(true),rejection=assert.rejects(f.pending,/연결 준비 중에 닫혔습니다/);f.acquisition.resolve(s);await flush();s.getVideoTracks()[0].end();await rejection;assert.ok(s.getTracks().every(t=>t.readyState==='ended'));f.video.playback.reject(new Error('late decoder failure'));await flush();
});
test('decoder failure and pre-ended source never leave an acquired track live',async t=>{
 const f=fixture(t),s=stream(true),rejection=assert.rejects(f.pending,/decoder failure/);f.acquisition.resolve(s);await flush();f.video.playback.reject(new Error('decoder failure'));await rejection;assert.ok(s.getTracks().every(t=>t.readyState==='ended'));
 const g=fixture(t),ended=stream(true),endRejection=assert.rejects(g.pending,/닫혔습니다/);ended.getVideoTracks()[0].stop();g.acquisition.resolve(ended);await endRejection;assert.equal(ended.getAudioTracks()[0].readyState,'ended');
});
test('sound-only capture requires live audio and does not wait for or decode a picture',async t=>{
 const f=fixture(t,{picture:false}),s=stream(true);f.acquisition.resolve(s);assert.equal((await f.pending).stream,s);assert.equal(f.video.srcObject,null);assert.deepEqual(f.phases,['source']);
 const g=fixture(t,{picture:false}),silent=stream(),rejection=assert.rejects(g.pending,/출력 소리를 받지 못했습니다/);g.acquisition.resolve(silent);await rejection;assert.equal(silent.getTracks()[0].readyState,'ended');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const {createBackgroundObservation}=createRequire(import.meta.url)('../desktop/background-observation.cjs');
const flag='--backseat-background-observe';
function fixture(argv=[flag],renderer={ready:true,version:'0.1.17',bridge:true}){
  const reports=[],timers=[],cancelled=[],paused=[],resumed=[];
  const app={getVersion:()=> '0.1.17',quitCalls:0,quit(){this.quitCalls++;}};
  const studio={timer:{id:'original'},running:false,pumpCalls:0,pump(){this.pumpCalls++;},provider:{status:()=>({kind:'codex',model:'gpt-6.1-sol',effort:'low',key:'must-not-log',token:'must-not-log'})}};
  const window={isVisible:()=>false,webContents:{executeJavaScript:async()=>renderer}};
  const observer=createBackgroundObservation(argv,{schedule:(fn,ms)=>{const t={fn,ms};timers.push(t);return t;},cancel:t=>cancelled.push(t),pause:t=>paused.push(t),resume:(fn,ms)=>{const t={fn,ms};resumed.push(t);return t;},delay:async()=>{},write:v=>reports.push(v)});
  observer.attach(studio);
  return {observer,reports,timers,cancelled,paused,resumed,app,studio,window,run:()=>observer.ready({app,window,profile:'synthetic-profile'})};
}
test('ordinary startup retains window defaults and background work',async()=>{
  const f=fixture([]);assert.deepEqual(f.observer.windowOptions(),{});assert.deepEqual(f.paused,[]);
  assert.equal(await f.run(),false);assert.deepEqual(f.reports,[]);assert.deepEqual(f.timers,[]);
});
test('hidden observation checks the delivered renderer, reports only selected model fields and requests graceful quit',async()=>{
  const f=fixture();assert.deepEqual(f.observer.windowOptions(),{show:false});assert.deepEqual(f.paused,[{id:'original'}]);assert.equal(f.studio.timer,null);
  assert.equal(await f.run(),true);assert.equal(f.reports[0].passed,true);assert.equal(f.reports[0].displayedVersion,'0.1.17');
  assert.deepEqual(f.reports[0].provider,{kind:'codex',model:'gpt-6.1-sol',effort:'low'});assert.equal(JSON.stringify(f.reports).includes('must-not-log'),false);
  assert.equal(f.app.quitCalls,0);f.timers[0].fn();assert.equal(f.app.quitCalls,1);
});
test('interactive opening cancels observation and restores exactly one ordinary pump',async()=>{
  const f=fixture();await f.run();const timer=f.timers[0];
  assert.equal(f.observer.open(['Nagneon.exe']),true);assert.equal(f.observer.active,false);assert.deepEqual(f.cancelled,[timer]);assert.equal(f.resumed.length,1);assert.equal(f.resumed[0].ms,250);
  f.resumed[0].fn();assert.equal(f.studio.pumpCalls,1);timer.fn();assert.equal(f.app.quitCalls,0);
  f.observer.open([]);assert.equal(f.resumed.length,1);assert.equal(f.reports.at(-1).reason,'interactive-open');
});
test('a background second launch cannot bring an existing ordinary app forward',()=>{
  const f=fixture([]);assert.equal(f.observer.open([flag]),false);assert.deepEqual(f.reports,[]);assert.deepEqual(f.resumed,[]);
});
test('an interactive launch while the renderer is loading prevents later automatic shutdown',async()=>{
  let resolve;const f=fixture();f.window.webContents.executeJavaScript=()=>new Promise(r=>resolve=r);
  const pending=f.run();f.observer.open([]);resolve({ready:true,version:'0.1.17',bridge:true});
  assert.equal(await pending,false);assert.equal(f.reports.length,1);assert.deepEqual(f.timers,[]);
});
test('observation rejects a visible window, a failed renderer, a version mismatch or a started broadcast',async()=>{
  for(const kind of ['visible','renderer','version','broadcast','preload','periodic']){
    const f=fixture();
    if(kind==='visible')f.window.isVisible=()=>true;
    if(kind==='renderer')f.window.webContents.executeJavaScript=async()=>({ready:false});
    if(kind==='version')f.window.webContents.executeJavaScript=async()=>({ready:true,bridge:true,version:'0.1.16'});
    if(kind==='broadcast')f.studio.running=true;
    if(kind==='preload')f.window.webContents.executeJavaScript=async()=>({ready:true,bridge:false});
    if(kind==='periodic')f.studio.timer={id:'unexpected'};
    await f.run();assert.equal(f.reports[0].passed,false,kind);assert.ok(f.reports[0].error);assert.equal(f.timers.length,1);f.timers[0].fn();assert.equal(f.app.quitCalls,1);
  }
});
test('normal shutdown disposes the observation timer without restoring paused work',async()=>{
  const f=fixture();await f.run();f.observer.dispose();f.timers[0].fn();assert.equal(f.app.quitCalls,0);assert.deepEqual(f.resumed,[]);assert.equal(f.studio.timer,null);
});
test('shutdown during renderer readiness cancels the remaining observation without restoring work',async()=>{
  let resolve;const f=fixture();f.window.webContents.executeJavaScript=()=>new Promise(r=>resolve=r);
  const pending=f.run();f.observer.dispose();resolve({ready:true,version:'0.1.17',bridge:true});
  assert.equal(await pending,false);assert.deepEqual(f.reports,[]);assert.deepEqual(f.timers,[]);assert.deepEqual(f.resumed,[]);
});

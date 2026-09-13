import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {existsSync} from 'node:fs';
import {createRequire} from 'node:module';
import {RequestLifetime} from '../server/request-lifetime.js';
import {CodexProvider} from '../server/codex-provider.js';
import {startServer} from '../server/index.js';
import {defaults} from '../shared/defaults.js';
const {installGracefulQuit}=createRequire(import.meta.url)('../desktop/graceful-quit.cjs');
const deferred=()=>{let resolve;const promise=new Promise(r=>resolve=r);return {promise,resolve};};

test('shutdown aborts requests, waits for finally, rejects late success and forbids new work',async()=>{
  const lifetime=new RequestLifetime(),started=deferred(),cleanup=deferred();let finished=false,newWork=false;
  const request=lifetime.run(async signal=>{started.resolve(signal);await cleanup.promise;finished=true;return 'late';});
  const rejection=assert.rejects(request,/앱 종료/),signal=await started.promise;
  let closed=false;const drain=lifetime.close();assert.equal(lifetime.close(),drain);drain.then(()=>closed=true);
  assert.equal(signal.aborted,true);await Promise.resolve();assert.equal(closed,false);assert.equal(finished,false);
  await assert.rejects(lifetime.run(()=>{newWork=true;}),/앱 종료/);assert.equal(newWork,false);
  cleanup.resolve();await rejection;await drain;assert.equal(finished,true);assert.equal(lifetime.pending.size,0);
});

test('server close owns a Codex call with an independent caller signal through frame removal',async()=>{
  const spawned=deferred();let child,dir,killed=false;
  const provider=new CodexProvider({},(_bin,_args,options)=>{
    dir=options.cwd;child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.kill=()=>{killed=true;return true;};spawned.resolve();return child;
  });provider.available=true;provider.check=async()=>provider.status();
  const service=await startServer({port:0,persist:false,localSpeech:false,provider});
  const request=service.studio.provider.react({settings:structuredClone(defaults),history:[],speech:'synthetic',image:'data:image/jpeg;base64,eA=='},new AbortController().signal);
  const rejection=assert.rejects(request,/취소/);await spawned.promise;
  let closed=false;const closing=service.close();assert.equal(service.close(),closing);closing.then(()=>closed=true);
  assert.equal(killed,true);assert.equal(existsSync(dir),true);await Promise.resolve();assert.equal(closed,false);
  child.emit('close',1);await rejection;await closing;assert.equal(existsSync(dir),false);assert.equal(service.server.listening,false);
});

test('server waits for other cleanup even if a worker close throws synchronously',async()=>{
  const soundFinished=deferred();let soundClosed=false;
  const provider={status:()=>({configured:true}),react:async()=>{}};
  const service=await startServer({port:0,persist:false,localSpeech:false,provider,
    speechWorker:{close:()=>{throw Error('synthetic speech close failure');}},
    soundWorker:{close:async()=>{soundClosed=true;await soundFinished.promise;}}});
  let finished=false;const closing=service.close();const rejection=assert.rejects(closing,error=>error instanceof AggregateError&&error.errors[0].message==='synthetic speech close failure');
  closing.then(()=>finished=true,()=>finished=true);assert.equal(soundClosed,true);await Promise.resolve();assert.equal(finished,false);
  soundFinished.resolve();await rejection;assert.equal(service.server.listening,false);
});

function appFixture(){
  const app=new EventEmitter();app.exits=[];app.quit=()=>{const event={prevented:false,preventDefault(){this.prevented=true;}};app.emit('will-quit',event);if(!event.prevented)app.exits.push(0);return event;};app.exit=code=>app.exits.push(code);return app;
}
test('native repeated quit events cannot bypass the pending cleanup barrier',async()=>{
  const app=appFixture(),cleanup=deferred();let calls=0;
  const shutdown=installGracefulQuit(app,async()=>{calls++;await cleanup.promise;});
  assert.equal(app.quit().prevented,true);assert.equal(shutdown.quitting,true);app.quit();await Promise.resolve();
  assert.equal(calls,1);assert.deepEqual(app.exits,[]);app.quit();assert.deepEqual(app.exits,[]);
  cleanup.resolve();await shutdown.pending;assert.deepEqual(app.exits,[0]);assert.equal(calls,1);
});
test('native cleanup failure is reported with an unsuccessful exit',async()=>{
  const app=appFixture(),errors=[];const shutdown=installGracefulQuit(app,()=>{throw Error('synthetic failure');},{onError:error=>errors.push(error.message)});
  app.quit();await shutdown.pending;assert.deepEqual(errors,['synthetic failure']);assert.deepEqual(app.exits,[1]);
});

test('a fast cleanup waits until the native quit event unwinds before retrying',async()=>{
  const app=new EventEmitter();let nativeQuitting=false;const exits=[];
  app.quit=()=>{
    if(nativeQuitting)return;
    nativeQuitting=true;const event={prevented:false,preventDefault(){this.prevented=true;}};
    app.emit('will-quit',event);
    // Electron's C++ observer resets its flag after the JS callback's
    // microtasks. A promise-only retry can still be inside that observer.
    if(event.prevented)setImmediate(()=>{nativeQuitting=false;});else exits.push(0);
  };
  const shutdown=installGracefulQuit(app,()=>Promise.resolve());app.quit();await shutdown.pending;
  assert.deepEqual(exits,[0]);
});

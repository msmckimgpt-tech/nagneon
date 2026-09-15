import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir,mkdtemp } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createHash } from 'node:crypto';
import { distributionComponents } from '../scripts/lib/distribution-components.mjs';
import { RuntimeComponents } from '../server/runtime-components.js';
const hash=b=>createHash('sha256').update(b).digest('hex');
async function fixture(download){
  await mkdir('artifacts',{recursive:true});const cache=await mkdtemp(resolve('artifacts/components-'));
  const paths=['resources/speech/python/p','resources/speech/model/m','resources/speech/microphone-model/m','resources/speech/gpu/g'];
  const components=distributionComponents(paths.map(path=>({path,bytes:1,sha256:hash('x')}))).filter(c=>c.id!=='app');
  for(const c of components)c.archive={format:'nagneon-runtime-gzip/1',bytes:1,sha256:hash('z'),url:'https://example.invalid/'+c.id};
  const calls=[];
  const manager=new RuntimeComponents({cache,catalog:{format:'nagneon-runtime-catalog/1',components},download:async args=>{calls.push(args.component.id);await download?.(args);return {path:'fixture'};},install:async()=>({path:'fixture'})});
  return {manager,calls};
}
const tick=()=>new Promise(r=>setImmediate(r));

test('shared runtime preparation deduplicates downloads and one cancelled consumer does not cancel another',async()=>{
  let release;const gate=new Promise(r=>release=r);let audioSignal;
  const {manager,calls}=await fixture(async({component,signal})=>{if(component.id==='audio'){audioSignal=signal;await gate;signal.throwIfAborted();}});
  const first=new AbortController(),second=new AbortController();
  const mic=manager.prepare('microphone',first.signal,'cpu');const micFailure=assert.rejects(mic);
  const sound=manager.prepare('sound',second.signal);
  while(!audioSignal)await tick();first.abort();await micFailure;assert.equal(audioSignal.aborted,false);
  release();await sound;assert.deepEqual(calls,['audio','sound']);
  await manager.prepare('microphone',undefined,'gpu');assert.deepEqual(calls,['audio','sound','microphone','gpu']);
  await manager.close();assert.equal(manager.jobs.size,0);
});

test('cancelling the last consumer and closing the app drain the underlying job',async()=>{
  const {manager}=await fixture(({signal})=>new Promise((yes,no)=>{signal.addEventListener('abort',()=>no(signal.reason),{once:true});}));
  const controller=new AbortController(),pending=manager.prepare('clips',controller.signal),rejected=assert.rejects(pending);
  while(!manager.jobs.size)await tick();await tick();controller.abort();await rejected;
  await manager.close();assert.equal(manager.jobs.size,0);assert.equal(manager.snapshot().components.find(c=>c.id==='audio').status,'idle');
  await assert.rejects(manager.prepare('clips'),/종료/);
});

test('preparation failure can retry and state never exposes download URLs or local paths',async()=>{
  let fail=true;const {manager,calls}=await fixture(async()=>{if(fail)throw Error('network');});
  await assert.rejects(manager.prepare('clips'));
  assert.equal(manager.snapshot().components[0].status,'error');
  fail=false;await manager.prepare('clips');assert.equal(manager.snapshot().components[0].status,'ready');
  assert.deepEqual(calls,['audio','audio']);const text=JSON.stringify(manager.snapshot());assert.ok(!text.includes('example.invalid'));assert.ok(!text.includes(manager.cache));
  await manager.close();
});

test('lightweight runtime resolves absent optional files while full bundles retain mandatory checks',async()=>{
  const {createRequire}=await import('node:module'),{join}=await import('node:path'),{writeFile}=await import('node:fs/promises');
  const {packagedRuntime}=createRequire(import.meta.url)('../desktop/runtime.cjs');
  const {manager}=await fixture();const resources=join(manager.cache,'base');
  for(const file of ['codex/bin/codex.exe','speech/speech_worker.py','speech/clip_inspector.py','speech/clip_perception.py','sound/sound_worker.py']){await mkdir(join(resources,file,'..'),{recursive:true});await writeFile(join(resources,file),'fixture');}
  assert.throws(()=>packagedRuntime(resources),/실행 파일/);
  const runtime=packagedRuntime(resources,{cache:manager.cache,catalog:{format:'nagneon-runtime-catalog/1',components:[...manager.components.values()]}});
  assert.match(runtime.speech.python,/installed/);assert.equal(runtime.speech.modelName,'medium');assert.equal(runtime.clips.python,runtime.sound.python);
  await manager.close();
});

test('actual authenticated HTTP prepares only requested components and exposes no paths or URLs',async t=>{
  const {startServer}=await import('../server/index.js');const {downloadRuntimePack}=await import('../server/runtime-download.js');const {gzipSync}=await import('node:zlib');
  const {manager}=await fixture(),bytes=gzipSync(Buffer.from('x'));let fetched=0;
  const components=[...manager.components.values()].map(c=>({...c,archive:{...c.archive,bytes:bytes.length,sha256:hash(bytes)}}));await manager.close();
  const app=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:false})},runtime:{speech:{},sound:{},clips:{},clipPerception:{},components:{cache:manager.cache,catalog:{format:'nagneon-runtime-catalog/1',components},download:args=>downloadRuntimePack({...args,fetcher:async()=>{fetched++;return new Response(bytes);}})}}});
  t.after(()=>app.close());assert.equal(fetched,0);
  assert.equal((await fetch(app.url+'/api/runtime/prepare',{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({feature:'clips'})})).status,401);assert.equal(fetched,0);
  const res=await fetch(app.url+'/api/runtime/prepare',{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio',Authorization:'Bearer '+app.accessToken},body:JSON.stringify({feature:'clips'})});assert.equal(res.status,200);assert.equal(fetched,1);
  const state=app.studio.state().runtimeComponents;assert.equal(state.components.find(c=>c.id==='audio').status,'ready');assert.ok(state.components.filter(c=>c.id!=='audio').every(c=>c.status==='idle'));assert.ok(!JSON.stringify(state).includes(manager.cache));
  const {readdir}=await import('node:fs/promises');const {join}=await import('node:path');assert.deepEqual(await readdir(join(manager.cache,'downloads')),[]);
  const reuse=new RuntimeComponents({cache:manager.cache,catalog:{format:'nagneon-runtime-catalog/1',components},download:()=>{throw Error('offline');}});await reuse.prepare('clips');assert.equal(reuse.snapshot().components.find(c=>c.id==='audio').status,'ready');await reuse.close();
});

test('app shutdown aborts a live download without waiting for its caller to cancel',async()=>{
  let started=false;const {manager}=await fixture(({signal})=>{started=true;return new Promise((yes,no)=>{signal.throwIfAborted();signal.addEventListener('abort',()=>no(signal.reason),{once:true});});});
  const pending=manager.prepare('clips'),rejected=assert.rejects(pending);
  while(!started)await tick();await manager.close();await rejected;assert.equal(manager.jobs.size,0);
});

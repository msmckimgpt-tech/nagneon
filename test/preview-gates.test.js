import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,writeFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startServer} from '../server/index.js';
import {resolveDebugPrompt} from '../shared/debug-prompt.js';
import {StateFeed} from '../server/state-stream.js';
import {EventEmitter} from 'node:events';

test('both opt-ins are required at the authenticated API and prompt boundary',async t=>{
  let obsConnections=0,obsCloses=0;
  class Obs extends EventEmitter{
    async connect(){obsConnections++;}
    async disconnect(){obsCloses++;}
    async call(){return {scenes:[{sceneName:'fixture'}]};}
  }
  const service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true})},obsClientFactory:()=>new Obs()});
  t.after(()=>service.close());
  const req=async(path,body,method='POST')=>fetch(service.url+'/api/'+path,{method,headers:{Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  assert.equal(service.studio.state().debug.previewEnabled,false);
  for(const [enabled,tryNewFeatures] of [[false,false],[true,false],[false,true],[true,true]]){
    const config={enabled,tryNewFeatures,mode:'replace',prompt:'custom'};
    assert.equal((await req('debug',config,'PUT')).status,200);
    const active=enabled&&tryNewFeatures;
    assert.equal(service.studio.state().debug.previewEnabled,active);
    assert.equal(resolveDebugPrompt('base',config),active?'custom':'base');
    const view=await (await req('debug',undefined,'GET')).json();
    assert.equal(!!view.basePrompt,active);
    if(!active){
      for(const path of ['obs/connect','obs/select','obs/frame','external/youtube/connect','external/chzzk/start','external/chzzk/open','connection/provider'])assert.equal((await req(path,{})).status,403,path);
      assert.equal((await req('react',{obsSourceId:'00000000-0000-4000-8000-000000000000'})).status,403);
      assert.equal((await req('debug/settings',{},'PUT')).status,409);
      assert.equal(obsConnections,0);
    }else assert.equal((await req('obs/connect',{port:4455,password:''})).status,200);
  }
  assert.equal(obsConnections,1);
  await req('debug',{enabled:true,tryNewFeatures:false,mode:'replace',prompt:'custom'},'PUT');
  assert.equal(service.obsInput.snapshot().phase,'disconnected');assert.ok(obsCloses>0);
});

test('legacy debug and saved Ollama cannot activate preview on restart; disabling restores baseline',async()=>{
  const folder=await mkdtemp(resolve('artifacts/preview-gates-'));let service,localCreated=0;
  const backend=kind=>({status:()=>({configured:true,kind}),check:async()=>{},react:async()=>kind});
  try{
    await writeFile(resolve(folder,'debug.json'),JSON.stringify({enabled:true,mode:'replace',prompt:'old prompt'}));
    await writeFile(resolve(folder,'provider-choice.json'),JSON.stringify({kind:'ollama',model:'fixture'}));
    const options={port:0,dataDir:folder,localSpeech:false,providerFactories:{codex:()=>backend('codex'),openai:()=>backend('openai'),ollama:()=>{localCreated++;return backend('ollama');}}};
    service=await startServer(options);
    assert.equal(localCreated,0);assert.equal(service.studio.provider.status().kind,'codex');
    assert.equal(service.studio.state().debug.tryNewFeatures,false);
    const set=async enabled=>{
      const r=await fetch(service.url+'/api/debug',{method:'PUT',headers:{Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'},body:JSON.stringify({enabled:true,tryNewFeatures:enabled,mode:'replace',prompt:'custom'})});
      assert.equal(r.status,200);
    };
    await set(true);assert.equal(service.studio.provider.status().kind,'ollama');assert.equal(localCreated,1);
    await set(false);assert.equal(service.studio.provider.status().kind,'codex');
    await service.close();service=await startServer(options);
    assert.equal(service.studio.provider.status().kind,'codex');assert.equal(localCreated,1);
  }finally{await service?.close();await rm(folder,{recursive:true,force:true});}
});

test('existing SSE connections return to full snapshots when preview is disabled',()=>{
  const response=new EventEmitter(),frames=[];response.write=value=>{frames.push(value);return true;};
  let enabled=false;const state={large:'a'.repeat(2000),counter:0};
  const feed=new StateFeed(response,{patches:true,enabled:()=>enabled,currentState:()=>state});
  feed.send(state);state.counter++;feed.send(state);assert.ok(frames.every(f=>f.startsWith('data: ')));
  enabled=true;feed.send(state);state.counter++;feed.send(state);assert.match(frames.at(-1),/^event: state-patch/);
  enabled=false;state.counter++;feed.send(state);assert.match(frames.at(-1),/^data: /);feed.close();
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {resolve} from 'node:path';
import {startServer} from '../server/index.js';
const config={kind:'routing',version:1,connections:[{id:'main',label:'구독',provider:{kind:'codex',model:'future'}},{id:'api',label:'개별 API',provider:{kind:'openai',model:'custom',base:'https://example.com/v1'}}],routes:{default:{primary:'main'},chat:{primary:'api'}}};
test('API routes persist with the same world, isolate credentials and cancel individual probes',async()=>{
  const folder=await mkdtemp(resolve('artifacts/routing-api-'));let service,block=false,entered,gate=true;
  const factory=c=>({model:c?.model||'default',effort:'low',key:'',bin:'official-cli',env:{},check:async()=>{},status(){return {configured:true,model:this.model};},react:async(_args,signal)=>{if(block){entered();await new Promise((_,reject)=>signal.addEventListener('abort',()=>reject(signal.reason),{once:true}));}return {observation:{messages:[{personaId:'probe',text:'안녕하세요'}]},usage:{total_tokens:1}};}});
  const options={port:0,dataDir:folder,localSpeech:false,providerSwitchAllowed:()=>gate,providerFactories:{codex:factory,configuredApi:factory}};
  const post=async(path,body={})=>{const r=await fetch(service.url+'/api/'+path,{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify(body)});return {ok:r.ok,value:await r.json()};};
  try{
    service=await startServer(options);const title=service.studio.settings.title;
    assert.equal((await post('connection/provider',config)).ok,true);
    assert.equal((await post('connection/routing/key',{id:'api',apiKey:'private-key'})).ok,true);
    assert.ok(!JSON.stringify(service.studio.state()).includes('private-key'));
    assert.ok(!(await readFile(resolve(folder,'provider-choice.json'),'utf8')).includes('private-key'));
    gate=false;assert.equal((await post('connection/routing/key',{id:'api',apiKey:'other'})).ok,false);gate=true;
    await service.close();service=await startServer(options);assert.equal(service.studio.settings.title,title);assert.equal(service.studio.state().providerChoice.routing.config.connections[1].provider.model,'custom');
    assert.equal((await post('connection/routing/probe',{id:'api'})).value.status,'ready');
    block=true;const waiting=new Promise(r=>entered=r),pending=post('connection/routing/probe',{id:'api'});await waiting;
    assert.equal((await post('connection/provider',{kind:'codex'})).ok,false);
    await post('connection/probe/cancel');assert.equal((await pending).value.status,'cancelled');
    assert.equal((await post('connection/provider',{kind:'codex'})).ok,true);assert.equal(service.studio.settings.title,title);
  }finally{await service?.close();await rm(folder,{recursive:true,force:true});}
});

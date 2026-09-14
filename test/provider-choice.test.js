import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderChoice} from '../server/provider-choice.js';
const backend=(kind,configured=true)=>({model:kind,bin:'official-cli',env:{test:true},key:'private-key',status:()=>({configured,model:kind}),check:async()=>{},react:async()=>kind,transcribe:async()=>kind});
test('stable provider facade switches inference while preserving audio and Codex login identity',async()=>{
  const codex=backend('codex'),saved=[];const choice=new ProviderChoice({factories:{codex:()=>codex,ollama:()=>backend('ollama')},save:c=>saved.push(c)}),provider=choice.proxy;
  provider.localSpeech=true;provider.transcribe=async()=> 'local-stt';const initialStatus=provider.status.bind(provider);provider.status=()=>({...initialStatus(),audioReady:true});
  await choice.select({kind:'ollama',model:'test'});assert.equal(await provider.react(),'ollama');assert.equal(await provider.transcribe(),'local-stt');assert.equal(provider.bin,'official-cli');assert.equal(provider.status().audioReady,true);
  await choice.select({kind:'codex'});assert.equal(await provider.react(),'codex');assert.equal(choice.active,codex);assert.equal(saved.length,2);assert.ok(!JSON.stringify(choice.snapshot()).includes('private-key'));
});
test('failed readiness, save, cancellation or intervening activity cannot replace the active provider',async()=>{
  const primary=backend('codex'),local=backend('local',false);const choice=new ProviderChoice({factories:{codex:()=>primary,ollama:()=>local}});
  await assert.rejects(choice.select({kind:'ollama',model:'test'}));assert.equal(choice.active,primary);
  local.status=()=>({configured:true});choice.save=()=>{throw Error('disk');};await assert.rejects(choice.select({kind:'ollama',model:'test'}),/disk/);assert.equal(choice.active,primary);
  choice.save=()=>{};await assert.rejects(choice.select({kind:'ollama',model:'test'},{canApply:()=>false}));assert.equal(choice.active,primary);
  const controller=new AbortController();local.check=async()=>controller.abort();await assert.rejects(choice.select({kind:'ollama',model:'test'},{signal:controller.signal}));assert.equal(choice.active,primary);assert.equal(choice.changing,false);
});

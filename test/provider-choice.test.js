import test from 'node:test';
import assert from 'node:assert/strict';
import {ProviderChoice,ProviderSelection,hostedModelEnv} from '../server/provider-choice.js';
import {CodexProvider} from '../server/codex-provider.js';
import {OpenAIProvider} from '../server/provider.js';
const backend=(kind,configured=true)=>({model:kind,bin:'official-cli',env:{test:true},key:'private-key',status:()=>({configured,model:kind}),check:async()=>{},react:async()=>kind,transcribe:async()=>kind});
test('stable provider facade switches inference while preserving audio and Codex login identity',async()=>{
  const codex=backend('codex'),saved=[];const choice=new ProviderChoice({factories:{codex:()=>codex,ollama:()=>backend('ollama')},save:c=>saved.push(c)}),provider=choice.proxy;
  provider.localSpeech=true;provider.transcribe=async()=> 'local-stt';const initialStatus=provider.status.bind(provider);provider.status=()=>({...initialStatus(),audioReady:true});
  await choice.select({kind:'ollama',model:'test'});assert.equal(await provider.react(),'ollama');assert.equal(await provider.transcribe(),'local-stt');assert.equal(provider.bin,'official-cli');assert.equal(provider.status().audioReady,true);
  await choice.select({kind:'codex'});assert.equal(await provider.react(),'codex');assert.equal(choice.active,codex);assert.equal(saved.length,2);assert.ok(!JSON.stringify(choice.snapshot()).includes('private-key'));
});

test('hosted model selection persists across construction, preserves keys and audio, and restores defaults',async()=>{
  const make=config=>{
    const env={OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low',...hostedModelEnv(config)};
    return {model:env.OPENAI_MODEL,effort:env.OPENAI_REASONING_EFFORT,key:'initial-secret',bin:'official-cli',env:{},check:async()=>{},status(){return {configured:true,model:this.model,effort:this.effort};}};
  };
  const factories={codex:make,openai:make};let saved;
  const choice=new ProviderChoice({factories,save:c=>saved=c}),original=choice.active;
  choice.proxy.localSpeech=true;choice.proxy.transcribe=async()=> 'local';
  const config={kind:'codex',model:'gpt-5.4-mini',effort:'none'};
  await choice.select(config);assert.notEqual(choice.active,original);assert.equal(original.model,'gpt-6-astra');
  assert.equal(choice.proxy.model,'gpt-5.4-mini');assert.equal(choice.proxy.effort,'none');assert.equal(await choice.proxy.transcribe(),'local');
  assert.deepEqual(saved,config);assert.ok(!JSON.stringify(choice.snapshot()).includes('secret'));
  const reloaded=new ProviderChoice({factories,initial:saved});assert.equal(reloaded.proxy.model,'gpt-5.4-mini');assert.equal(reloaded.proxy.effort,'none');
  choice.save=()=>{throw Error('disk');};await assert.rejects(choice.select({...config,model:'gpt-6-astra',effort:'low'}),/disk/);assert.equal(choice.proxy.model,'gpt-5.4-mini');assert.equal(choice.proxy.effort,'none');
  choice.save=()=>{};await choice.select({kind:'openai',model:'gpt-5.4-mini',effort:'low'});choice.proxy.key='session-secret';
  await choice.select({kind:'openai',model:'gpt-6-astra',effort:'low'});assert.equal(choice.active.key,'session-secret');
  await choice.select({kind:'openai'});assert.equal(choice.proxy.model,'gpt-6-astra');assert.equal(choice.active.key,'session-secret');
  await choice.select({kind:'codex'});assert.equal(choice.active,original);assert.equal(choice.proxy.localSpeech,true);
});

test('model/effort schema rejects invalid pairs and credentials while legacy choices stay valid',()=>{
  assert.deepEqual(ProviderSelection.parse({kind:'codex'}),{kind:'codex'});
  for(const config of [{kind:'codex',model:'unknown'},{kind:'codex',model:'gpt-6-astra',effort:'none'},{kind:'codex',effort:'none'},{kind:'openai',model:'gpt-5.4-mini',effort:'ultra'},{kind:'openai',model:'gpt-5.4-mini',apiKey:'secret'}])assert.equal(ProviderSelection.safeParse(config).success,false);
  for(const kind of ['codex','openai'])for(const effort of ['none','low','medium','high','xhigh'])assert.equal(ProviderSelection.safeParse({kind,model:'gpt-5.4-mini',effort}).success,true);
  for(const effort of ['none','low','medium','high','xhigh','max'])assert.equal(ProviderSelection.safeParse({kind:'codex',model:'gpt-5.6-luna',effort}).success,true);
  assert.equal(ProviderSelection.safeParse({kind:'codex',model:'gpt-5.4-mini',effort:'max'}).success,false);
  for(const Provider of [CodexProvider,OpenAIProvider]){
    const provider=new Provider({...hostedModelEnv({model:'gpt-5.4-mini',effort:'none'})});
    assert.equal(provider.model,'gpt-5.4-mini');assert.equal(provider.effort,'none');
  }
});
test('failed readiness, save, cancellation or intervening activity cannot replace the active provider',async()=>{
  const primary=backend('codex'),local=backend('local',false);const choice=new ProviderChoice({factories:{codex:()=>primary,ollama:()=>local}});
  await assert.rejects(choice.select({kind:'ollama',model:'test'}));assert.equal(choice.active,primary);
  local.status=()=>({configured:true});choice.save=()=>{throw Error('disk');};await assert.rejects(choice.select({kind:'ollama',model:'test'}),/disk/);assert.equal(choice.active,primary);
  choice.save=()=>{};await assert.rejects(choice.select({kind:'ollama',model:'test'},{canApply:()=>false}));assert.equal(choice.active,primary);
  const controller=new AbortController();local.check=async()=>controller.abort();await assert.rejects(choice.select({kind:'ollama',model:'test'},{signal:controller.signal}));assert.equal(choice.active,primary);assert.equal(choice.changing,false);
});

test('Gemini account choice switches both ways and survives restart without changing audio',async()=>{
  const factories={codex:()=>backend('codex'),antigravity:()=>backend('gemini')};let saved;
  const choice=new ProviderChoice({factories,save:c=>saved=c});
  choice.proxy.transcribe=async()=> 'local-speech';
  const config={kind:'antigravity',model:'gemini-test',effort:'low'};
  await choice.select(config);
  assert.equal(await choice.proxy.react(),'gemini');
  assert.equal(await choice.proxy.transcribe(),'local-speech');
  assert.deepEqual(saved,config);
  assert.equal(new ProviderChoice({factories,initial:saved}).status().kind,'antigravity');
  await choice.select({kind:'codex'});
  assert.equal(await choice.proxy.react(),'codex');
  assert.equal(await choice.proxy.transcribe(),'local-speech');
});

test('Gemini selection refuses credentials, non-Gemini model names and unsupported effort',()=>{
  assert.equal(ProviderSelection.safeParse({kind:'antigravity'}).success,true);
  for(const extra of [{apiKey:'secret'},{model:'gpt-6-sol'},{model:'gemini-bad name'},{effort:'xhigh'}])
    assert.equal(ProviderSelection.safeParse({kind:'antigravity',...extra}).success,false);
});

// Opt-in real subscription/local readiness and one synthetic subscription response.
// No user profile, camera, screen capture, microphone or paid API is used.
import {mkdtemp,writeFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import assert from 'node:assert/strict';
import {startServer} from '../server/index.js';
import {defaults} from '../shared/defaults.js';
if(!process.argv.includes('--live'))throw Error('Explicit --live is required: consumes a subscription response.');
const folder=await mkdtemp(resolve('artifacts/routing-live-'));let service;
const report={folder,syntheticInput:true,realProviders:true,paidApiCalls:0,checks:[]};
try{
  service=await startServer({port:0,dataDir:resolve(folder,'data'),localSpeech:false});
  const post=async(path,body)=>{const response=await fetch(service.url+'/api/'+path,{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify(body)});const value=await response.json();if(!response.ok)throw Error(value.error);return value;};
  const config={kind:'routing',version:1,connections:[{id:'subscription',label:'구독',provider:{kind:'codex',model:'gpt-6-astra',effort:'low'}},{id:'local',label:'로컬',provider:{kind:'ollama',model:'gemma3:1b',contextSize:32768}}],routes:{default:{primary:'subscription'},vision:{primary:'local',fallbacks:['subscription'],timeoutMs:60000}}};
  report.saved=await post('connection/provider',config);
  assert.equal(report.saved.routing.connections.every(c=>c.configured),true);
  report.checks.push('real official subscription login status and installed Ollama model readiness');
  const settings={...structuredClone(defaults),title:'격리 라우팅 시험',webSearch:false,personas:[{...defaults.personas[0],id:'probe',name:'연결 도우미'}]};
  // A generated one-pixel PNG, never a captured user screen. Text-only Gemma
  // must be skipped before sending an image; the explicit subscription fallback runs.
  const image='data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=';
  const at=Date.now();const result=await service.studio.provider.react({settings,history:[],speech:'연결 확인입니다. 짧은 한국어 인사 한 문장으로 답하세요.',image,adviceRequested:false},new AbortController().signal);
  report.response={latencyMs:Date.now()-at,routing:result.routing,messages:result.observation.messages,usage:result.usage};
  assert.equal(result.routing.connectionId,'subscription');assert.deepEqual(result.routing.attempts.map(a=>[a.id,a.called]),[['local',false],['subscription',true]]);assert.ok(result.observation.messages.some(m=>m.personaId==='probe'&&/[가-힣]/.test(m.text)));
  report.checks.push('actual subscription inference via explicit fallback after local capability check');
  await service.close();service=await startServer({port:0,dataDir:resolve(folder,'data'),localSpeech:false});
  assert.equal(service.studio.state().providerChoice.routing.config.routes.vision.primary,'local');
  report.checks.push('routing survived server restart with same isolated profile');report.passed=true;
}catch(e){report.passed=false;report.error=e.message;process.exitCode=1;}
finally{await service?.close();await writeFile(resolve(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));}

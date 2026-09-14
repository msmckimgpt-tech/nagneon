// Opt-in real local inference. The caller supplies a known synthetic PNG;
// this script never installs a model, captures the desktop or changes settings.
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {createHash} from 'node:crypto';
import {OllamaProvider} from '../server/ollama-provider.js';
import {defaults} from '../shared/defaults.js';
const imagePath=process.argv.find(arg=>arg.startsWith('--image='))?.slice(8);
if(!imagePath||!process.env.OLLAMA_MODEL)throw Error('Set OLLAMA_MODEL and pass --image=<synthetic PNG path>.');
const png=await readFile(resolve(imagePath));
if(png.subarray(0,8).toString('hex')!=='89504e470d0a1a0a')throw Error('Expected a PNG fixture.');
await mkdir('artifacts',{recursive:true});
const base=await mkdtemp(resolve('artifacts/ollama-acceptance-'));
const report={base,startedAt:new Date().toISOString(),structuralPassed:false,reviewRequired:true,
  scope:'Full default prompt, synthetic typed greeting and supplied image. Semantic review required; not game, microphone or UI acceptance.',
  imageSha256:createHash('sha256').update(png).digest('hex'),calls:[]};
let raw;
const provider=new OllamaProvider(process.env,async(...args)=>{
  const response=await fetch(...args);
  if(args[0].endsWith('/chat'))raw=await response.clone().json();
  return response;
});
report.model=provider.model;report.contextSize=provider.contextSize;
const common={settings:{...structuredClone(defaults),webSearch:false},history:[],adviceRequested:false};
for(const scenario of [
  {name:'greeting',speech:'안녕! 오늘 같이 게임하면서 편하게 이야기하자.'},
  {name:'vision',speech:'화면에 보이는 도형의 색과 위치만 짧게 말해 줘.',image:'data:image/png;base64,'+png.toString('base64')}
]){
  const {name,...input}=scenario;const started=Date.now();raw=undefined;
  const call={name};
  try{Object.assign(call,await provider.react({...common,...input}));}catch(error){call.error=error.message;}
  call.latencyMs=Date.now()-started;call.raw=raw;report.calls.push(call);
  await writeFile(join(base,'result.json'),JSON.stringify(report,null,2));
  console.log(JSON.stringify({name,latencyMs:call.latencyMs,error:call.error,messages:call.observation?.messages}));
}
report.structuralPassed=report.calls.every(call=>!call.error);
await writeFile(join(base,'result.json'),JSON.stringify(report,null,2));
console.log(JSON.stringify({base,structuralPassed:report.structuralPassed,reviewRequired:true}));
if(!report.structuralPassed)process.exitCode=1;

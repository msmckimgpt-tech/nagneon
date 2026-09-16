// Real local inference; synthetic conversation and optional supplied image only.
// Never uses a user profile or a paid provider. Save raw output for human review.
import {mkdir,mkdtemp,writeFile,readFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {startServer} from '../server/index.js';
import {OllamaProvider} from '../server/ollama-provider.js';
import {ConnectionProbe} from '../server/connection-probe.js';
import {seedMetAudience} from '../test/helpers/met-audience.js';

if(!process.env.OLLAMA_MODEL)throw Error('Set OLLAMA_MODEL.');
await mkdir('artifacts',{recursive:true});
const folder=await mkdtemp(resolve('artifacts/local-audience-'));
const report={model:process.env.OLLAMA_MODEL,folder,syntheticInputs:true,realInference:true,calls:[],turns:[],semanticReviewRequired:true};
const save=()=>writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));
const provider=new OllamaProvider(process.env,async(url,options)=>{
  if(process.env.LOCAL_TEST_NO_THINK==='1'&&url.endsWith('/chat')){
    const body=JSON.parse(options.body);body.think=false;options={...options,body:JSON.stringify(body)};
    report.diagnosticOverride='think=false';
  }
  const response=await fetch(url,options);
  if(url.endsWith('/chat')){
    const raw=await response.clone().json();
    report.calls.push({request:JSON.parse(options.body),response:raw});await save();
  }
  return response;
});
await provider.check();report.status=provider.status();
report.probe=await new ConnectionProbe(provider).run();await save();
console.log(JSON.stringify({model:report.model,probe:report.probe}));
if(report.probe.status!=='ready'){report.sessionSkipped='Readiness probe failed';await save();console.log(folder);process.exit(1);}
let now=Date.now();
const service=await startServer({port:0,persist:false,localSpeech:false,provider});
const studio=service.studio;studio.now=()=>now;studio.random=()=>.5;
clearInterval(studio.timer);seedMetAudience(studio);
studio.configure({...studio.settings,mode:'live',webSearch:false,communityActivityEnabled:false,lurkRatio:0,slowModeSeconds:0,chatPace:8,maxCalls:10});studio.start();
const imagePath=process.argv.find(a=>a.startsWith('--image='))?.slice(8);
const turns=[
  '모모, 안녕! 오늘 처음 하는 퍼즐 게임이라 좀 떨려. 한마디 응원해 줘.',
  '모모, 오늘 목표는 파란 열쇠를 찾는 거야. 기억해 줘.',
  '모모, 내가 방금 찾겠다고 한 물건이 뭐였지?',
  '각보는고양이, 아직 공략은 말하지 말고 그냥 같이 지켜봐 줘.',
  ...(imagePath?['모모, 화면에 보이는 도형의 색과 위치만 짧게 말해 줘.']:[])
];
try{
  for(let i=0;i<turns.length;i++){
    now+=30000;const speech=turns[i],start=Date.now(),before=studio.messages.length;
    studio.receiveSpeech({id:randomUUID(),sessionId:studio.sessionId,text:speech});
    const input=i===4?{image:'data:image/png;base64,'+(await readFile(imagePath)).toString('base64')}:{};
    let result;
    try{result=await studio.react(input);}catch(error){result={error:error.message};}
    for(let j=0;j<20&&studio.queue.length;j++){now+=1000;studio.pump();}
    const turn={speech,latencyMs:Date.now()-start,result,error:studio.lastError,delivered:studio.messages.slice(before).filter(m=>m.kind==='chat'),observation:studio.observation};
    report.turns.push(turn);await save();console.log(JSON.stringify({model:report.model,...turn}));
  }
}finally{
  await service.close();
  report.deliveryPassed=report.turns.length===turns.length&&report.turns.every(t=>!t.error&&!t.result?.error&&t.delivered.length>0);
  await save();console.log(folder);
}
if(!report.deliveryPassed)process.exitCode=1;

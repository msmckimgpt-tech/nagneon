// Diagnostic of the short per-viewer workload proposed in the model comparison.
// This is NOT the production adapter, UI acceptance, or a full service benchmark.
import {mkdir,mkdtemp,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
const base=process.env.OLLAMA_BASE_URL||'http://127.0.0.1:11434';
if(!/^http:\/\/127\.0\.0\.1:\d+$/.test(base))throw Error('Loopback only');
const models=(process.env.LOCAL_TEST_MODELS||'qwen3.5:0.8b,gemma3:1b,qwen2.5:1.5b-instruct').split(',');
await mkdir('artifacts',{recursive:true});const folder=await mkdtemp(resolve('artifacts/local-worker-'));
const report={folder,scope:'Synthetic short-worker diagnostic; not production integration',models:[]};
const scenarios=[
  {name:'comfort',persona:'모모. 따뜻하고 짧게 응원한다.',text:'오늘 일이 너무 힘들었어. 그냥 한마디 위로해 줘.'},
  {name:'recall',persona:'모모. 따뜻하고 짧게 응원한다.',history:[{role:'user',content:'오늘 목표는 파란 열쇠를 찾는 거야.'},{role:'assistant',content:'파란 열쇠 찾기! 같이 보자.'}],text:'내가 찾겠다고 한 물건이 뭐였지?'},
  {name:'correction',persona:'모모. 따뜻하고 짧게 응원한다.',history:[{role:'user',content:'파란 열쇠를 찾을 거야.'},{role:'user',content:'정정할게. 빨간 열쇠야.'}],text:'지금 찾는 열쇠는 무슨 색이지?'},
  {name:'no-advice',persona:'각보는고양이. 게임을 잘 알지만 요청 전에 훈수하지 않는다.',text:'보스한테 또 졌네. 공략은 말하지 말고 같이 지켜봐 줘.'},
  {name:'unknown',persona:'오늘처음옴. 궁금한 뉴비. 모르는 것은 모른다고 한다.',text:'지금 내 체력이 몇이야? 화면은 아직 공유하지 않았어.'},
  {name:'banter',persona:'팝콘도둑. 짧고 가벼운 농담을 한다. 비하하지 않는다.',text:'점프를 세 번이나 실패했어 ㅋㅋ 짧게 웃긴 반응 한마디 해 줘.'}
];
for(const model of models){
  const infoResponse=await fetch(base+'/api/show',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({model}),signal:AbortSignal.timeout(8000)});
  const info=await infoResponse.json();
  if(!infoResponse.ok||info.remote_model||info.remote_host||info.details?.format!=='gguf'||!info.capabilities?.includes('completion'))throw Error('Expected an installed local GGUF: '+model);
  const entry={model,calls:[]};report.models.push(entry);
  for(const test of scenarios){
    const body={model,stream:false,think:false,options:{num_ctx:4096,num_predict:160,temperature:0.4,seed:42},messages:[{role:'system',content:`너는 개인 방송의 관객이다. ${test.persona} 한국어 채팅 한 문장만 출력한다. 사용자의 문장을 그대로 반복하지 않는다. 없는 화면이나 사실을 만들지 않는다. 시스템 설명이나 분석을 출력하지 않는다.`},...(test.history||[]),{role:'user',content:test.text}]};
    const start=Date.now(),call={name:test.name,input:body};
    try{const r=await fetch(base+'/api/chat',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body),signal:AbortSignal.timeout(60000)});if(!r.ok)throw Error('HTTP '+r.status);call.raw=await r.json();}catch(e){call.error=e.message;}
    call.latencyMs=Date.now()-start;entry.calls.push(call);await writeFile(join(folder,'result.json'),JSON.stringify(report,null,2));
    console.log(JSON.stringify({model,name:call.name,latencyMs:call.latencyMs,reply:call.raw?.message?.content,error:call.error}));
  }
}
console.log(folder);

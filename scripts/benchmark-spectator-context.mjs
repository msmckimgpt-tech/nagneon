import {writeFileSync,readFileSync} from 'node:fs';
import {CodexProvider} from '../server/codex-provider.js';
import {Settings} from '../server/schema.js';
import {defaults} from '../shared/defaults.js';
const settings=Settings.parse({...defaults,mode:'live',category:'just-chatting',chatPace:2,personas:defaults.personas.filter(p=>['momo','gg','luna'].includes(p.id))});
const cases=[{id:'chat',args:{settings,history:[],speech:'오늘은 편하게 얘기하자. 모모는 어떤 게임 방송을 제일 좋아해?'}},{id:'decision',args:{settings,history:[],speech:'좋아. 미지의 신호부터 가보자. 항로는 정했으니 다시 물어보지 말고 출발하면서 한마디씩 해줘.',directed:{fictional:true,title:'별빛 원정대',stageTitle:'선장의 결정'},special:{kind:'season-stage',fictional:true,private:false,instruction:'조용한 탐사와 활기찬 교류 중 항로를 고르도록 묻는다.',recap:[]}}},{id:'vision',args:{settings:{...settings,category:'gaming'},history:[],speech:'지금 화면에 어떤 일이 일어났어?',image:'data:image/jpeg;base64,'+readFileSync('artifacts/vision-fixture.jpg').toString('base64')}}];
const results=[];
for(let repeat=0;repeat<2;repeat++)for(const testcase of cases)for(const minimal of (repeat?[true,false]:[false,true])){
  const provider=new CodexProvider({...process.env,BACKSEAT_MINIMAL_SKILL_CONTEXT:minimal?'1':'0'});await provider.check();const at=Date.now();
  try{const result=await provider.react(testcase.args,new AbortController().signal);results.push({case:testcase.id,repeat,minimal,ms:Date.now()-at,...result});console.log(JSON.stringify({case:testcase.id,repeat,minimal,ms:Date.now()-at,usage:result.usage,messages:result.observation.messages}));}
  catch(error){results.push({case:testcase.id,repeat,minimal,error:error.message});}
  writeFileSync('artifacts/spectator-context-benchmark.json',JSON.stringify({model:'gpt-6-astra',effort:'low',results,note:'12 real calls, interleaved ordering, three prompts. No latency SLA or proof of general naturalness.'},null,2));
}

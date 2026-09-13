import {readFileSync,writeFileSync} from 'node:fs';
import assert from 'node:assert/strict';
import {CodexProvider} from '../server/codex-provider.js';
import {Settings} from '../server/schema.js';
import {defaults} from '../shared/defaults.js';
const settings=Settings.parse({...defaults,mode:'live',chatPace:2,personas:defaults.personas.filter(p=>['momo','gg','luna'].includes(p.id))});
const cases=[{id:'conversation',args:{settings:{...settings,category:'just-chatting'},history:[],speech:'오늘은 편하게 얘기하자. 모모는 어떤 게임 방송을 제일 좋아해?',audience:{eligible:['momo','gg'],members:[{id:'momo',presence:'active',relationship:'첫 방문'},{id:'gg',presence:'active',relationship:'첫 방문'}]}}},{id:'vision',args:{settings,history:[],speech:'지금 화면에 어떤 일이 일어났어?',image:'data:image/jpeg;base64,'+readFileSync('artifacts/vision-fixture.jpg').toString('base64')}}];
const results=[];
for(const testcase of cases)for(const compact of [false,true]){
  const p=new CodexProvider({...process.env,BACKSEAT_COMPACT_INSTRUCTIONS:compact?'1':'0'});await p.check();const at=Date.now();const result=await p.react(testcase.args,new AbortController().signal);
  assert.ok(result.observation.messages.length);assert.ok(result.observation.messages.every(m=>settings.personas.some(p=>p.id===m.personaId)));if(testcase.id==='vision')assert.match(result.observation.scene,/20|3|BOSS|보스|승리|격파|처치/i);
  results.push({case:testcase.id,compact,milliseconds:Date.now()-at,...result});writeFileSync('artifacts/instructions-benchmark.json',JSON.stringify({results,note:'Four real requests; small controlled sample, not a latency guarantee.'},null,2));console.log(JSON.stringify({case:testcase.id,compact,milliseconds:Date.now()-at,usage:result.usage}));
}

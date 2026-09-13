// Real subscription model; deterministic simulated arrival clock. No external community traffic.
import assert from 'node:assert/strict';
import {writeFile} from 'node:fs/promises';
import {CodexProvider} from '../server/codex-provider.js';
import {Audience} from '../server/audience.js';
import {Studio} from '../server/studio.js';
import {defaults} from '../shared/defaults.js';
const provider=new CodexProvider();await provider.check();assert.ok(provider.status().configured);
let now=Date.now();const audience=new Audience(undefined,()=>{},()=>.1);
const studio=new Studio({provider,audience,now:()=>now,random:()=>.1,settings:{...defaults,mode:'live',category:'just-chatting',lurkRatio:0,maxCalls:1,discovery:{enabled:true,arrivalSeconds:10,mix:{clip:0,guide:100,fan:0,discussion:0,browse:0}}}});
try{
  studio.start();assert.equal(audience.presence.gg,'waiting');now+=10000;studio.pump();assert.equal(audience.presence.gg,'active');
  const start=Date.now();await studio.react({speech:'각보는고양이 어서 오세요! 오늘 처음 오셨죠? 오늘은 게임을 잠깐 쉬고 이야기하는 방송이에요. 게임의 어떤 점이 재미있어요?'});const latencyMs=Date.now()-start;
  now+=15000;for(let i=0;i<8;i++)studio.pump();
  const result={passed:true,fixture:'simulated arrival clock; real GPT-6 Astra low; no image or external community browsing',latencyMs,state:studio.state()};
  assert.equal(result.state.observation.game,'Just Chatting');assert.ok(result.state.messages.some(m=>m.personaId==='gg'));assert.equal(result.state.calls,1);
  await writeFile('artifacts/discovery-live-result.json',JSON.stringify(result,null,2));console.log(JSON.stringify({passed:true,latencyMs,messages:result.state.messages,origin:audience.data.members.gg.origin},null,2));
}finally{studio.close();}

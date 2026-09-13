import test from 'node:test';
import assert from 'node:assert/strict';
import {requestsAdvice} from '../server/advice-intent.js';
import {startServer} from '../server/index.js';
import {OpenAIProvider} from '../server/provider.js';

test('explicit Korean and English requests allow hints',()=>{
  for(const speech of ['여기서 막혔어. 힌트와 훈수 좀 부탁해!','힌트 하나만 주세요','훈수 좀 해줘','도와 주세요','도와줄 수 있어?','이 퍼즐 어떻게 풀어야 돼?','어떤 카드를 골라야 할까?','공략 찾아줘','훈수!','help','can you help me?','give me a hint'])assert.equal(requestsAdvice(speech),true,speech);
});
test('declined, historical and merely mentioned advice never opens request-only hints',()=>{
  for(const speech of ['아직 훈수는 말고 지금 같이 보이는 것과 들리는 분위기만 짧게 얘기해 주세요.','훈수하지 마','힌트는 아직 필요 없어','공략은 말아 주세요','이거 또 막혔네','어떻게 지냈어?','저번에 힌트 부탁했는데 재밌었어','"훈수 좀 해줘"라고 채팅이 올라왔네','no hints please','please stop backseating','do not help me','이 퍼즐 어떻게 푸는지 알려주지 마'])assert.equal(requestsAdvice(speech),false,speech);
});
test('explicit corrections keep the final request or refusal, and never policy stays closed',()=>{
  assert.equal(requestsAdvice('힌트 하나만 부탁해요. 화면에 퍼즐 안쪽이 보이지 않으면 아는 척하지 말고, 지금 보이는 지도에서 확인할 수 있는 범위만 말해 주세요.'),true);
  assert.equal(requestsAdvice('훈수는 말고 힌트 하나만 주세요'),true);
  assert.equal(requestsAdvice('힌트는 그만. 그런데 이제 훈수 좀 해줘'),true);
  assert.equal(requestsAdvice('훈수 좀 부탁해. 아니, 이제 필요 없어'),false);
  assert.equal(requestsAdvice('힌트 하나만 주세요','never'),false);
});

test('live studio forwards refusal and request separately to the provider search gate',async t=>{
  const calls=[],provider=new OpenAIProvider();
  const service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true}),react:async args=>{calls.push({requested:args.adviceRequested,payload:provider.payload(args)});return {observation:{game:'Synthetic',scene:'Map',confidence:.8,excitement:0,messages:[]}};}}});
  t.after(()=>service.close());const s=service.studio;clearInterval(s.timer);s.configure({...s.settings,mode:'live',webSearch:true});s.start();
  await s.react({speech:'아직 훈수는 말고 지금 들리는 분위기만 말해 주세요.'});s.lastRequest=0;
  await s.react({speech:'지도에서 확인 가능한 힌트 하나만 주세요.'});
  assert.deepEqual(calls.map(c=>c.requested),[false,true]);
  assert.equal((calls[0].payload.tools||[]).some(t=>t.type==='web_search'),false);
  assert.equal(calls[1].payload.tools.some(t=>t.type==='web_search'),true);
});

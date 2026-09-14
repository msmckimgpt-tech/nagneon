import test from 'node:test';
import assert from 'node:assert/strict';
import {chatBriefing} from '../shared/chat-briefing.js';
const message=(id,text,extra={})=>({id,text,time:90_000,kind:'chat',personaId:'viewer',...extra});
const options={now:100_000,startedAt:50_000,enabledIds:['viewer','other']};
test('briefing excludes stale, future, fictional, disabled and streamer messages',()=>{
  const messages=[message('keep','이번 선택 좋다'),message('old','old',{time:49_999}),message('future','future',{time:100_001}),message('fiction','fiction',{fictional:true}),message('ban','ban',{personaId:'banned'}),message('speech','speech',{kind:'streamer'})];
  assert.deepEqual(chatBriefing(messages,options).items.map(m=>m.ids),[['keep']]);
  assert.equal(chatBriefing(messages,{...options,mode:'rehearsal'}).count,0);
});
test('briefing deduplicates only equal expressions and keeps source ids',()=>{
  const messages=[message('1','와  잘했다'),message('2','와 잘했다',{personaId:'other'}),message('3','와 못했다'),message('4','다음 게임 뭔가요?')];
  const report=chatBriefing(messages,options);
  assert.equal(report.count,4);assert.equal(report.speakers,2);
  assert.deepEqual(report.items.find(m=>m.ids.includes('1')).ids,['1','2']);assert.equal(report.items.find(m=>m.ids.includes('4')).question,true);
  assert.equal('text' in report.items[0],false);
});
test('deletion, clear, time expiry and session start cannot resurrect source text',()=>{
  const messages=[message('1','오늘 뭐 해요?')];
  assert.equal(chatBriefing(messages,options).count,1);
  assert.equal(chatBriefing([],options).count,0);
  assert.equal(chatBriefing(messages,{...options,now:151_000}).count,0);
  assert.equal(chatBriefing(messages,{...options,startedAt:95_000}).count,0);
});
test('briefing remains bounded while preserving some reactions alongside questions',()=>{
  const messages=Array.from({length:500},(_,i)=>message(String(i),i<490?`질문 ${i}?`:`반응 ${i}`));
  const report=chatBriefing(messages,options);
  assert.equal(report.count,500);assert.equal(report.items.length,5);
  assert.equal(report.items.filter(m=>m.question).length,3);
});

// Real Astra / low smoke using synthetic conversation and isolated in-memory credits.
import {writeFileSync} from 'node:fs';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {Studio} from '../server/studio.js';
import {CodexProvider} from '../server/codex-provider.js';
import {defaults} from '../shared/defaults.js';
const provider=new CodexProvider();await provider.check();if(!provider.status().configured)throw new Error(provider.status().authMessage);
const s=new Studio({provider,settings:{...defaults,mode:'live',category:'just-chatting',lurkRatio:0,maxCalls:12}}),steps=[];
async function step(name,fn){const at=Date.now();const value=await fn();steps.push({name,milliseconds:Date.now()-at,value});writeFileSync('artifacts/expansion-live-progress.json',JSON.stringify(steps,null,2));console.log(name+' '+(Date.now()-at)+'ms');return value;}
try{
  s.start();s.economy.data.balance=500; // test fixture only, never writes data/
  s.addMessage('streamer','오늘은 실제 기념일이 아니라 우리 방의 상상 속 100일 특집이야. 각자 어떤 방송을 좋아하는지도 말해줘.','streamer');
  s.director.start({episodeId:'anniversary',premise:'상상 속 첫 방송 100일. 모모와 지지의 서로 다른 취향을 나누는 친근한 밤.',targets:['momo','gg']});
  for(const text of ['우리 방에 온 걸 환영해. 오늘은 작은 가상 기념일이야.','모모는 어떤 방송 분위기가 좋고 지지는 어떤 게임 이야기가 좋아?','너희 취향이 달라도 같이 노는 이 분위기를 오래 기억하고 싶어.'])await step('episode-act-'+(s.director.active.stage+2),async()=>{await s.director.advance({text});return s.director.active.messages.slice(-3);});
  const ended=s.director.finish(),clip=s.director.clip(ended.id),source=s.messages.find(m=>m.kind==='chat');assert.ok(source);
  await step('fictional-inner-monologue',()=>s.special.generate({kind:'thought',messageId:source.id,requestId:randomUUID()}));
  await step('preference-interview',()=>s.special.generate({kind:'interview',personaId:'momo',question:'우리 방에서는 어떤 반응을 주고받을 때 가장 즐겁고, 어떤 농담은 피하고 싶어?',requestId:randomUUID()}));
  const {id:quoteId}=s.special.quote({kind:'cheer',text:'서로의 다른 취향을 존중하며 우리 크루에게 한 줄씩 응원해주세요.',targets:['momo','gg']});s.economy.bid(quoteId,s.economy.data.quotes.at(-1).ask);
  await step('negotiated-action',()=>s.special.generate({kind:'contract',quoteId,requestId:randomUUID()}));
  s.stop();const parent=s.clips.comment(clip.id,{name:s.settings.streamer,text:'이 가상 기념일에서 서로 취향을 이야기한 장면이 가장 좋았어.'});
  await step('hotclip-replies',async()=>{await s.clipFeatures.comments({id:clip.id,parentId:parent.id,targets:['momo','pop']});return s.clips.get(clip.id).comments;});
  assert.equal(s.calls,7);assert.ok(!s.economy.data.ledger.some(e=>e.kind==='donation'));assert.equal(s.economy.data.purchases.filter(p=>p.status==='completed').length,3);assert.ok(s.clips.get(clip.id).comments.some(c=>c.kind==='ai'&&c.parentId===parent.id));
  writeFileSync('artifacts/expansion-live-result.json',JSON.stringify({passed:true,realProvider:provider.status(),syntheticConversation:true,isolatedTestCredits:true,calls:s.calls,tokens:s.tokens,steps},null,2));
}finally{s.close();}

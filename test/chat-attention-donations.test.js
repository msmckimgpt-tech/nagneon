import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {Economy} from '../server/economy.js';
import {Settings,Observation} from '../server/schema.js';
import {EconomyData} from '../server/data-schema.js';
import {defaults} from '../shared/defaults.js';
import {chatAttention,publicDonation,donationMessage} from '../server/chat-attention.js';
import {liveViewerContext} from '../server/viewer-context.js';
import {startServer} from '../server/index.js';

const observation=(extra={})=>({game:'Synthetic',scene:'퍼즐을 풀고 기뻐하는 발언',confidence:.95,excitement:.95,messages:[],positiveMoment:{positive:true,impact:.95,signature:'synthetic-success',reason:'PRIVATE-MODEL-EVENT-ANALYSIS',supporters:['momo'],donations:[{personaId:'momo',message:'드디어 풀었다!',anonymous:true}]},...extra});
function fixture(t,{react}={}){
  let now=100000000;const requests=[];
  const s=new Studio({settings:{...defaults,mode:'live',category:'just-chatting',lurkRatio:0,intervalSeconds:5,slowModeSeconds:0},now:()=>now,random:()=>.5,audience:new Audience(undefined,()=>{},()=>.5),provider:{status:()=>({configured:true}),react:async args=>{requests.push(args);return {observation:react?react(args,requests.length):observation()};}}});
  clearInterval(s.timer);t.after(()=>s.close());s.start();s.audience.data.members.momo.seconds=120;
  return {s,requests,now:()=>now,advance:ms=>now+=ms};
}

test('anonymous donation conserves points, stores private identity, and public projections omit it',t=>{
  const {s}=fixture(t);const before=s.economy.data.balance+s.economy.data.wallets.momo.balance;
  const donations=s.economy.reward({observation:observation(),settings:s.settings,audience:s.audience,hasInput:true});
  assert.equal(donations.length,1);const d=donations[0];assert.equal(d.anonymous,true);assert.equal(d.name,'익명의 관객');assert.equal(d.personaId,undefined);assert.equal(d.text,'드디어 풀었다!');
  assert.equal(s.economy.data.balance+s.economy.data.wallets.momo.balance,before);
  const snapshot=s.economy.snapshot(s.settings.personas);assert.deepEqual(snapshot.ledger.at(-1),d);assert.equal(snapshot.wallets.momo.lastDonationAt,undefined);
  const stored=s.economy.data.ledger.at(-1);assert.equal(stored.personaId,'momo');assert.equal(stored.name,'모모');
  assert.equal(JSON.stringify(d).includes('PRIVATE-MODEL'),false);assert.equal(JSON.stringify(d).includes('momo'),false);
  assert.deepEqual(publicDonation(d),d);assert.equal(donationMessage(d).personaId,'anonymous');
});

test('free donor lookup survives restart and rename without unlocking personality or charging',t=>{
  const {s}=fixture(t);s.economy.reward({observation:observation(),settings:s.settings,audience:s.audience,hasInput:true});
  const restored=new Economy(EconomyData.parse(structuredClone(s.economy.data)),()=>{},s.now);const before=structuredClone(restored.data);
  const renamed=s.settings.personas.map(p=>p.id==='momo'?{...p,name:'새닉네임'}:p);
  for(let i=0;i<3;i++)assert.deepEqual(restored.donationHistory(renamed)[0],{...publicDonation(before.ledger.at(-1)),donorId:'momo',donorName:'모모',currentName:'새닉네임'});
  assert.deepEqual(restored.data,before);assert.equal(restored.data.purchases.length,0);
});

test('ordinary gifts retain public names; willingness, identity, cooldown and duplicate guards remain authoritative',t=>{
  const {s,advance}=fixture(t),o=observation();const args={settings:s.settings,audience:s.audience,hasInput:true};
  o.positiveMoment.donations=[];assert.deepEqual(s.economy.reward({...args,observation:o}),[]);
  o.positiveMoment.donations=[{personaId:'gg',message:'거짓 후보',anonymous:false}];assert.deepEqual(s.economy.reward({...args,observation:o}),[]);
  o.positiveMoment.donations=[{personaId:'momo',message:'축하해요!',anonymous:false},{personaId:'momo',message:'중복',anonymous:true}];
  const gifts=s.economy.reward({...args,observation:o});assert.equal(gifts.length,1);assert.equal(gifts[0].name,'모모');assert.equal(gifts[0].personaId,'momo');
  assert.deepEqual(s.economy.reward({...args,observation:o}),[]);advance(700000);assert.deepEqual(s.economy.reward({...args,observation:o}),[]);
});

test('anonymous self-signatures and blocked messages are hidden without replacing them with analytic reasons',t=>{
  for(const message of ['모모가 보냅니다','momo가 보냅니다','금지어 후원']){
    const {s}=fixture(t);s.settings.blockedWords=['금지어'];const o=observation();o.positiveMoment.donations[0].message=message;
    const [d]=s.economy.reward({observation:o,settings:s.settings,audience:s.audience,hasInput:true});assert.equal(d.text,'');assert.equal(donationMessage(d).text,'응원 포인트를 보냈어요.');
  }
});

test('failed gift persistence cannot publish or change either balance',t=>{
  const {s}=fixture(t);const before=structuredClone(s.economy.data);s.economy.save=()=>{throw Error('synthetic disk full');};
  assert.throws(()=>s.economy.reward({observation:observation(),settings:s.settings,audience:s.audience,hasInput:true}),/disk full/);assert.deepEqual(s.economy.data,before);assert.equal(s.messages.length,0);
});

test('chat attention keeps stream speech and highlights ahead of background chatter, bounded and chronological',()=>{
  const now=100000,p={id:'pop',name:'팝콘'};
  const history=[{id:'speech',personaId:'streamer',name:'방장',kind:'streamer',text:'이야기 이어갈게요',time:now-5000},donationMessage({id:randomUUID(),at:now-4000,name:'PRIVATE',personaId:'private-id',anonymous:true,amount:20,text:'응원해요'})];
  for(let i=0;i<60;i++)history.push({id:String(i),personaId:'gg',name:'다른 관객',kind:'chat',text:'배경 채팅',time:now-3000+i});
  history.push({id:'address',personaId:'gg',name:'다른 관객',kind:'chat',text:'팝콘님은 어떠세요?',time:now-2000});
  const a=chatAttention(history,p,{now});assert.equal(a.primary,'stream');assert.ok(a.items.length<=7);
  assert.ok(a.items.some(m=>m.attention==='streamer'));assert.ok(a.items.some(m=>m.attention==='highlight'));assert.ok(a.items.some(m=>m.attention==='addressed'));
  assert.ok(!JSON.stringify(a).includes('PRIVATE'));assert.deepEqual(a.items.map(m=>m.ageSeconds),a.items.map(m=>m.ageSeconds).sort((a,b)=>b-a));
});

test('late join, future records, expired and deleted gifts cannot enter attention',()=>{
  const history=[donationMessage({id:randomUUID(),at:1000,anonymous:true,amount:20,text:'과거 후원'}),donationMessage({id:randomUUID(),at:9000,anonymous:true,amount:20,text:'미래 후원'})];
  const audience={members:[{id:'new',joinedAt:2000}],eligible:['new']},personas=[{id:'new',name:'신입'}];
  const packet=liveViewerContext(audience,personas,history,null,{now:5000}).viewerContext.new;
  assert.deepEqual(packet.chatHistory,[]);assert.deepEqual(packet.chatAttention.items,[]);
  assert.deepEqual(chatAttention(history,personas[0],{now:100000}).items,[]);assert.deepEqual(chatAttention([],personas[0],{now:10000}).items,[]);
});

test('committed anonymous gift enters chat and memory, wakes viewers once, and cannot mint a feedback reward',async t=>{
  const {s,requests,advance}=fixture(t,{react:(_args,n)=>observation(n===1?{}:{positiveMoment:{...observation().positiveMoment,signature:'fabricated-second-success'},messages:[{personaId:'gg',kind:'chat',spoiler:false,text:'팝콘님 저 응원 멘트 좋네요'}]})});
  await s.react({image:'static',speech:'오래 걸렸지만 드디어 다 풀었어요!'});
  const gift=s.messages.find(m=>m.kind==='donation');assert.ok(gift);assert.equal(gift.personaId,'anonymous');
  const entry=s.journal.data.entries.find(e=>e.id===gift.id);assert.equal(entry.personaId,'anonymous');assert.equal(entry.name,'익명의 관객');
  assert.equal(s.observation.positiveMoment.supporters,undefined);assert.equal(s.observation.positiveMoment.donations,undefined);
  assert.ok(!JSON.stringify(s.state().observation).includes('PRIVATE-MODEL'));
  const balance=s.economy.data.balance;advance(6000);await s.react({image:'static'});
  assert.ok(requests[1].viewerContext.gg.chatAttention.items.some(m=>m.attention==='highlight'));
  assert.equal(s.economy.data.balance,balance);advance(2000);s.pump();assert.equal(s.messages.at(-1).chatDriven,true);
  advance(6000);assert.deepEqual(await s.react({image:'static'}),{skipped:'unchanged-input'});assert.equal(requests.length,2);
  s.moderate('delete',gift.id);assert.equal(s.journal.data.entries.some(e=>e.id===gift.id),false);assert.equal(s.economy.donationHistory().length,1,'moderation never refunds a committed gift');
});

test('peer replies addressing another viewer stop after one chat-only turn',async t=>{
  const {s,requests,advance}=fixture(t,{react:(_args,n)=>({game:'Synthetic',scene:'paused',confidence:.7,excitement:.2,messages:n===1?[]:[{personaId:'momo',text:'팝콘님 저는 탐험이 좋아요',kind:'chat',spoiler:false}]})});
  await s.react({image:'paused'});advance(6000);s.addMessage('pop','모모님은 어떤 게임이 좋아요?');await s.react({image:'paused'});advance(2000);s.pump();advance(6000);
  assert.equal((await s.react({image:'paused'})).skipped,'unchanged-input');assert.equal(requests.length,2);
});

test('donor lookup HTTP is authenticated and free; shared state/export omit anonymous mappings',async t=>{
  const service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true})}});t.after(()=>service.close());
  const {studio:s}=service,headers={Authorization:'Bearer '+service.accessToken};
  s.economy.change(d=>s.economy.entry(d,'donation',20,'공개 응원',{anonymous:true,personaId:'synthetic-donor',name:'PRIVATE-DONOR'}));
  const before=structuredClone(s.economy.data);
  assert.equal((await fetch(service.url+'/api/donations')).status,401);
  const res=await fetch(service.url+'/api/donations',{headers});assert.equal(res.status,200);const data=await res.json();assert.equal(data.entries[0].donorName,'PRIVATE-DONOR');
  for(const path of ['/api/state','/api/export']){const body=await (await fetch(service.url+path,{headers})).text();assert.ok(!body.includes('PRIVATE-DONOR'));assert.ok(!body.includes('synthetic-donor'));}
  assert.deepEqual(s.economy.data,before);
});

test('donation schemas reject malformed flags and oversized public messages while old saves remain valid',()=>{
  const o=observation();assert.equal(Observation.parse(o).positiveMoment.donations[0].anonymous,true);
  assert.throws(()=>Observation.parse({...o,positiveMoment:{...o.positiveMoment,donations:[{personaId:'momo',message:'x'.repeat(201),anonymous:true}]}}));
  const e=new Economy();e.entry(e.data,'donation',20,'legacy',{personaId:'momo',name:'모모'});assert.equal(EconomyData.safeParse(e.data).success,true);
  e.data.ledger.at(-1).anonymous='yes';assert.equal(EconomyData.safeParse(e.data).success,false);
});

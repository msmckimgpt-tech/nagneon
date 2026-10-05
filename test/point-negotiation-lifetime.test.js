import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {Economy} from '../server/economy.js';
import {Studio} from '../server/studio.js';
import {Settings} from '../server/schema.js';
import {defaults} from '../shared/defaults.js';
import {startServer} from '../server/index.js';

const settings=Settings.parse({...defaults,mode:'live',lurkRatio:0});
function fixture(t,provider={status:()=>({configured:true})}){
  let at=100000000;
  const studio=new Studio({settings,provider,now:()=>at});
  clearInterval(studio.timer);t.after(()=>studio.close());studio.start();
  const quote=(targets=['momo'])=>studio.special.quote({kind:'cheer',text:'짧게 응원해주세요',targets}).id;
  const agree=id=>studio.special.bid({id,amount:studio.economy.data.quotes.find(q=>q.id===id).ask});
  return {studio,quote,agree,advance:ms=>at+=ms};
}

test('open and agreed quotes expire at the deadline without rewriting history or settling an executing hold',t=>{
  const {studio:s,quote,agree,advance}=fixture(t);
  const open=quote(),agreed=quote(['gg']);agree(agreed);
  const executing=quote(['pop']);agree(executing);
  const held=s.economy.reserveContract(executing,randomUUID(),s.sessionId);
  const stored=structuredClone(s.economy.data);advance(600000);
  const state=s.state().economy;
  assert.equal(state.quotes.find(q=>q.id===open).status,'expired');
  assert.equal(state.quotes.find(q=>q.id===agreed).status,'expired');
  assert.equal(state.quotes.find(q=>q.id===executing).status,'executing');
  assert.equal(state.balance,stored.balance);assert.deepEqual(s.economy.data,stored);
  assert.throws(()=>s.economy.reserveContract(agreed,randomUUID(),s.sessionId),/유효한 협상/);
  assert.throws(()=>quote(['pop']),/진행 중인 협상/,'an expired but funded execution still owns its viewers');
  s.economy.finish(held.receipt.id,{kind:'contract',messages:[]});
  assert.equal(s.state().economy.quotes.find(q=>q.id===executing).status,'completed');
});

test('closing a broadcast cancels only unexecuted quotes in the public view and cannot accept a bid',t=>{
  const {studio:s,quote,agree}=fixture(t);
  const open=quote(),agreed=quote(['gg']);agree(agreed);
  const completed=quote(['pop']);agree(completed);
  const held=s.economy.reserveContract(completed,randomUUID(),s.sessionId);s.economy.finish(held.receipt.id,{messages:[]});
  const before=structuredClone(s.economy.data);s.stop();
  const publicQuotes=s.state().economy.quotes;
  assert.equal(publicQuotes.find(q=>q.id===open).status,'cancelled');
  assert.equal(publicQuotes.find(q=>q.id===agreed).status,'cancelled');
  assert.equal(publicQuotes.find(q=>q.id===completed).status,'completed');
  assert.deepEqual(s.economy.data,before);
  assert.throws(()=>s.special.bid({id:open,amount:99}),/현재 방송/);
  assert.deepEqual(s.economy.data,before);
});

test('a new broadcast can negotiate with the same viewer but cannot revive or charge an old agreement',async t=>{
  const {studio:s,quote,agree}=fixture(t);const old=quote();agree(old);const oldSession=s.sessionId;
  s.stop();s.start();assert.notEqual(s.sessionId,oldSession);
  const before=structuredClone(s.economy.data);
  assert.throws(()=>s.special.bid({id:old,amount:999}),/현재 방송/);
  await assert.rejects(s.special.generate({kind:'contract',quoteId:old,requestId:randomUUID()}),/현재 방송.*협상/);
  assert.deepEqual(s.economy.data,before);
  const current=quote();agree(current);
  assert.equal(s.state().economy.quotes.find(q=>q.id===old).status,'cancelled');
  assert.equal(s.state().economy.quotes.find(q=>q.id===current).status,'agreed');
  assert.throws(()=>quote(),/진행 중인 협상/);
});

test('bids require the original ordinary viewers to remain present and enabled',t=>{
  const {studio:s,quote}=fixture(t);const id=quote();const before=structuredClone(s.economy.data);
  for(const condition of ['absent','disabled','system','manager']){
    s.audience.presence.momo='active';s.settings=Settings.parse(settings);
    if(condition==='absent')s.audience.presence.momo='absent';
    if(condition==='disabled')s.settings.personas.find(p=>p.id==='momo').enabled=false;
    if(condition==='system')s.settings.personas.find(p=>p.id==='momo').system=true;
    if(condition==='manager')s.settings.managerId='momo';
    assert.throws(()=>s.special.bid({id,amount:99}),/관객이 현재 방송/);
    assert.deepEqual(s.economy.data,before);
  }
  s.settings=Settings.parse(settings);s.audience.presence.momo='lurking';
  s.special.bid({id,amount:99});assert.equal(s.economy.data.quotes[0].status,'agreed');
});

test('restored unexecuted agreements remain recorded but cannot block a fresh broadcast',t=>{
  const {studio:s,quote,agree}=fixture(t);const id=quote();agree(id);
  const stored=structuredClone(s.economy.data);
  const restored=new Studio({settings,economy:new Economy(stored,()=>{},s.now),now:s.now,provider:{status:()=>({configured:true})}});
  clearInterval(restored.timer);t.after(()=>restored.close());
  assert.equal(restored.state().economy.quotes.find(q=>q.id===id).status,'cancelled');
  assert.equal(restored.economy.data.quotes.find(q=>q.id===id).status,'agreed');
  assert.equal(restored.economy.data.balance,stored.balance);
  restored.start();assert.doesNotThrow(()=>restored.special.quote({kind:'cheer',text:'다시 만났네요',targets:['momo']}));
});

test('a pending contract is refunded once after restart without paying its viewers',t=>{
  const {studio:s,quote,agree}=fixture(t);const id=quote();agree(id);
  const starting=structuredClone(s.economy.data),requestId=randomUUID();
  s.economy.reserveContract(id,requestId,s.sessionId);
  const restored=new Economy(structuredClone(s.economy.data),()=>{},s.now);
  assert.equal(restored.data.balance,starting.balance);
  assert.deepEqual(restored.data.wallets,starting.wallets);
  assert.equal(restored.data.quotes.find(q=>q.id===id).status,'failed');
  restored.refund(requestId,'중복 취소');
  assert.equal(new Economy(structuredClone(restored.data),()=>{},s.now).data.balance,starting.balance);
  assert.equal(restored.data.ledger.filter(e=>e.kind==='refund').length,1);
});

test('a late contract reply after stop refunds its hold and cannot settle or publish into the next broadcast',async t=>{
  let release;
  const {studio:s,quote,agree}=fixture(t,{status:()=>({configured:true}),react:()=>new Promise(r=>release=r)});
  const id=quote();agree(id);const before=structuredClone(s.economy.data),requestId=randomUUID();
  const pending=s.special.generate({kind:'contract',quoteId:id,requestId});
  const rejected=assert.rejects(pending,{message:'방송 상태가 바뀌어 실행을 취소하고 포인트를 반환했습니다.'});
  assert.ok(s.economy.data.balance<before.balance);s.stop();s.start();
  release({observation:{messages:[{personaId:'momo',text:'지난 방송 응원',kind:'chat',spoiler:false}]}});
  await rejected;
  assert.equal(s.economy.data.balance,before.balance);
  assert.deepEqual(s.economy.data.wallets,before.wallets);
  assert.equal(s.economy.data.purchases.find(p=>p.id===requestId).status,'failed');
  assert.equal(s.messages.length,0);
  assert.doesNotThrow(()=>quote());
});

test('quote projection remains read-only when persistence is unavailable',t=>{
  const {studio:s,quote,agree,advance}=fixture(t);const id=quote();agree(id);const before=structuredClone(s.economy.data);
  s.economy.save=()=>{throw Error('synthetic disk unavailable');};advance(600000);
  assert.equal(s.state().economy.quotes.find(q=>q.id===id).status,'expired');
  assert.deepEqual(s.economy.data,before);
  assert.throws(()=>s.special.bid({id,amount:99}),/만료/);
  assert.deepEqual(s.economy.data,before);
});

test('authenticated HTTP bids enforce broadcast lifetime before any settlement',async t=>{
  const dataDir=await mkdtemp(join(tmpdir(),'nagneon-point-lifetime-'));
  const service=await startServer({port:0,dataDir,localSpeech:false,provider:{status:()=>({configured:true})}});
  t.after(async()=>{await service.close();await rm(dataDir,{recursive:true,force:true});});
  const s=service.studio;clearInterval(s.timer);s.audience.random=()=>.1;
  s.world.change(d=>{d.settings=settings;for(const p of settings.personas)d.audience.members[p.id]={sessions:1,seconds:300,recognized:0,affinity:.5,peers:{},memories:[]};});
  s.start();const id=s.special.quote({kind:'cheer',text:'HTTP로 가격 제안',targets:['momo']}).id;
  const post=async amount=>{const response=await fetch(service.url+'/api/special/bid',{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'},body:JSON.stringify({id,amount})});return {status:response.status,body:await response.json()};};
  assert.equal((await post(1)).status,200);
  s.stop();const stopped=structuredClone(s.economy.data);const offline=await post(99);
  assert.equal(offline.status,409);assert.match(offline.body.error,/현재 방송/);assert.deepEqual(s.economy.data,stopped);
  s.start();const stale=await post(99);assert.equal(stale.status,409);assert.match(stale.body.error,/현재 방송/);
  assert.doesNotThrow(()=>s.special.quote({kind:'cheer',text:'새 방송의 HTTP 협상',targets:['momo']}));
});

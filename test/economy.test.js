import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Economy} from '../server/economy.js';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {Settings} from '../server/schema.js';
import {defaults} from '../shared/defaults.js';
const settings=Settings.parse({...defaults,mode:'live',lurkRatio:0});
function setup(){let now=100000000;const e=new Economy(undefined,()=>{},()=>now);e.ensureWallets(settings.personas);const a=new Audience(undefined,()=>{},()=>.1);a.start(settings,now);a.data.members.momo.seconds=120;a.data.members.gg.seconds=120;return {e,a,now:()=>now,advance:ms=>now+=ms};}
const moment=(extra={})=>({game:'Test',scene:'victory',confidence:.95,excitement:.95,messages:[],positiveMoment:{positive:true,impact:.95,reason:'어려운 도전을 끝내고 함께 기뻐함',signature:'first boss victory',supporters:['momo','gg']},...extra});
test('viewer recharge uses elapsed real time, caps, survives restart and handles backwards clock',()=>{
  const s=setup();s.advance(125000);assert.equal(s.e.snapshot(settings.personas).wallets.momo.balance,82);
  const reloaded=new Economy(structuredClone(s.e.data),()=>{},s.now);assert.equal(reloaded.snapshot(settings.personas).wallets.momo.balance,82);
  s.advance(-120000);assert.equal(reloaded.snapshot(settings.personas).wallets.momo.balance,82);
  s.advance(86400000);assert.equal(reloaded.snapshot(settings.personas).wallets.momo.balance,200);
  reloaded.change(d=>{reloaded.wallet(d,'momo');});s.advance(-86400000);assert.equal(reloaded.snapshot(settings.personas).wallets.momo.balance,200);
});
test('only strong positive moments reward eligible viewers and duplicate events cannot pay twice',()=>{
  const {e,a,advance}=setup();const args={settings,audience:a,hasInput:true};const before=e.data.balance;
  assert.deepEqual(e.reward({...args,observation:moment({positiveMoment:{...moment().positiveMoment,positive:false}})}),[]);
  assert.deepEqual(e.reward({...args,observation:moment(),paid:true}),[]);
  const gifts=e.reward({...args,observation:moment()});assert.equal(gifts.length,2);assert.equal(e.data.balance,before+gifts.reduce((s,g)=>s+g.amount,0));
  const total=e.data.balance;e.reward({...args,observation:moment()});advance(700000);e.reward({...args,observation:moment()});assert.equal(e.data.balance,total);
  const restarted=new Economy(structuredClone(e.data),()=>{},e.now);assert.deepEqual(restarted.reward({...args,observation:moment()}),[]);
});
test('purchases are idempotent, atomic, and crash-held points are refunded once',()=>{
  const {e}=setup(),id=randomUUID();e.purchase(id,'thought','message',15);assert.equal(e.data.balance,45);assert.equal(e.purchase(id,'thought','message',15).existing,true);assert.equal(e.data.balance,45);
  assert.throws(()=>e.purchase(id,'profile','momo',30));
  const reload=new Economy(structuredClone(e.data));assert.equal(reload.data.balance,60);assert.equal(reload.data.purchases[0].status,'failed');reload.refund(id,'again');assert.equal(reload.data.balance,60);
});
test('failed persistence cannot partially deduct a purchase',()=>{
  const {e}=setup();let fail=false;const atomic=new Economy(structuredClone(e.data),()=>{if(fail)throw new Error('disk full');});fail=true;
  assert.throws(()=>atomic.purchase(randomUUID(),'thought','x',15),/disk full/);assert.equal(atomic.data.balance,60);assert.equal(atomic.data.purchases.length,0);
});
test('negotiation counteroffers, refusal, agreed execution and wallet capacity are enforced',()=>{
  const {e,a,advance}=setup();e.data.balance=500;
  const id=e.quote({targets:['gg'],kind:'cheer',text:'짧게 응원해주세요',settings,audience:a,sessionId:'session'});
  e.bid(id,1);assert.equal(e.data.quotes[0].status,'open');e.bid(id,e.data.quotes[0].ask);assert.equal(e.data.quotes[0].status,'agreed');
  const requestId=randomUUID(),held=e.reserveContract(id,requestId,'session');const before=e.data.wallets.gg.balance;
  advance(60000);e.finish(requestId,{messages:[]});assert.equal(e.data.wallets.gg.balance,before+1+held.receipt.cost);assert.equal(e.data.quotes[0].status,'completed');
  assert.throws(()=>e.reserveContract(id,randomUUID(),'session'));assert.equal(e.reserveContract(id,requestId,'session').existing,true);
  const refusal=e.quote({targets:['momo'],kind:'custom',text:'부탁',settings,audience:a,sessionId:'session'});for(let n=0;n<3;n++)e.bid(refusal,1);assert.equal(e.data.quotes.find(q=>q.id===refusal).status,'declined');
  advance(86400000);const full=e.quote({targets:['gg'],kind:'cheer',text:'응원',settings,audience:a,sessionId:'session'});e.bid(full,100);assert.throws(()=>e.reserveContract(full,randomUUID(),'session'),/지갑/);
});
test('profile and relationship unlocks update without charging again',t=>{
  const s=new Studio({settings,provider:{status:()=>({configured:true})}});t.after(()=>s.close());s.start();const r=s.special.unlock({kind:'profile',personaId:'momo',requestId:randomUUID()});assert.equal(r.result.kind,'profile');assert.equal(s.economy.data.balance,30);
  s.audience.data.members.momo.recognized++;const again=s.special.unlock({kind:'profile',personaId:'momo',requestId:randomUUID()});assert.equal(again.cached,true);assert.equal(again.result.recognized,1);assert.equal(s.economy.data.balance,30);
});
test('model failure or session cancellation refunds special-feature holds',async t=>{
  let finish;const provider={status:()=>({configured:true}),react:()=>new Promise(r=>finish=r)};
  const s=new Studio({settings,provider});t.after(()=>s.close());s.start();const id=randomUUID();const job=s.special.generate({kind:'interview',personaId:'momo',question:'어떤 방송이 좋아요?',requestId:id});assert.equal(s.economy.data.balance,20);
  s.stop();finish({observation:{messages:[{personaId:'momo',text:'편한 방송',kind:'chat',spoiler:false}]}});await assert.rejects(job);assert.equal(s.economy.data.balance,60);assert.equal(s.economy.data.purchases[0].status,'failed');
});

test('private preference interviews persist for their owner without entering public chat context',async t=>{
  const requests=[];const provider={status:()=>({configured:true}),react:async args=>{requests.push(args);return {observation:{messages:[{personaId:'momo',text:'실수를 오래 놀리지 않는 편안한 방송이 좋아요.',kind:'chat',spoiler:false}]}};}};
  const s=new Studio({settings,provider});t.after(()=>s.close());s.start();s.economy.data.balance=200;
  await s.special.generate({kind:'interview',personaId:'momo',question:'어떤 방송을 좋아해요?',requestId:randomUUID()});
  await s.special.generate({kind:'interview',personaId:'momo',question:'그 취향은 지금도 같아요?',requestId:randomUUID()});
  assert.equal(requests[1].audience.members[0].privateInterviews.length,1);assert.equal(requests[1].audience.members.length,1);assert.equal(s.messages.length,0);assert.equal(s.profile,undefined);
  const report=s.special.profile('momo');assert.equal(report.preferences.length,2);assert.match(report.preferences[0].answers[0],/편안한/);assert.equal(s.audience.data.members.momo.privateInterviews,undefined);assert.equal(s.special.profile('gg').preferences.length,0);
});

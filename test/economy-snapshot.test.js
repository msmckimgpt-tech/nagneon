import test from 'node:test';
import assert from 'node:assert/strict';
import {Economy} from '../server/economy.js';
import rules from '../shared/economy.json' with {type:'json'};

function fixture(){
 let at=1700000000000,saves=0;
 const economy=new Economy(undefined,()=>saves++,()=>at);
 economy.ensureWallets([{id:'viewer'}]);
 economy.data.wallets.viewer={balance:rules.walletCap-3,refillAt:at,lastDonationAt:0,paidUntil:0};
 economy.data.quotes=[{id:'quote',floor:12,status:'open',expiresAt:at+1000,targets:['viewer'],history:[{text:'원본 협상',amount:12}]}];
 economy.data.purchases=[{id:'purchase',kind:'contract',key:'quote',cost:2,status:'pending',at,fingerprint:'private-fingerprint',shares:{viewer:2},result:{items:[{text:'원본 결과'}]}}];
 economy.data.ledger.push({id:'gift',at,kind:'donation',amount:1,text:'응원',anonymous:true,personaId:'viewer',name:'비공개 이름'});
 return {economy,advance:ms=>at+=ms,saves:()=>saves};
}

test('snapshot projects recharge and expiry without persisting them or changing escrow',()=>{
 const {economy,advance,saves}=fixture();const before=structuredClone(economy.data),saved=saves();
 advance(rules.refillSeconds*1000*5);
 const first=economy.snapshot([{id:'viewer'},{id:'new-viewer'}]);
 assert.equal(first.wallets.viewer.balance,rules.walletCap-2);
 assert.equal(first.wallets.viewer.nextRefillAt,null);
 assert.equal(first.wallets['new-viewer'].balance,rules.initialWallet);
 assert.equal(first.quotes[0].status,'expired');
 assert.deepEqual(economy.snapshot([{id:'viewer'},{id:'new-viewer'}]),first);
 assert.deepEqual(economy.data,before);assert.equal(saves(),saved);
});

test('public nested records cannot mutate saved history or later snapshots',()=>{
 const {economy}=fixture();const before=structuredClone(economy.data),first=economy.snapshot([{id:'viewer'}]);
 first.quotes[0].history[0].text='수정';first.quotes[0].targets.push('extra');
 first.purchases[0].result.items[0].text='수정';first.ledger[0].text='수정';first.wallets.viewer.balance=-1;
 assert.deepEqual(economy.data,before);
 const next=economy.snapshot([{id:'viewer'}]);assert.equal(next.quotes[0].history[0].text,'원본 협상');assert.equal(next.purchases[0].result.items[0].text,'원본 결과');
});

test('snapshot redacts anonymous donors and private pricing/purchase fields',()=>{
 const {economy}=fixture();economy.data.moments=[{fingerprint:'private-moment',amount:1,at:0}];
 const value=economy.snapshot([{id:'viewer'}]);const donation=value.ledger.at(-1);
 assert.equal(donation.name,'익명의 관객');assert.equal(donation.personaId,undefined);
 assert.equal(value.quotes[0].floor,undefined);assert.equal(value.purchases[0].fingerprint,undefined);assert.equal(value.purchases[0].shares,undefined);assert.equal(value.moments,undefined);
 assert.equal(value.wallets.viewer.lastDonationAt,undefined);
 assert.doesNotMatch(JSON.stringify(value),/private-fingerprint|private-moment|비공개 이름/);
});

test('a snapshot reflects later refunds and recharge without stale cached values',()=>{
 const {economy,advance}=fixture();economy.data.balance=50;
 const before=economy.snapshot([{id:'viewer'}]);economy.refund('purchase','취소');advance(rules.refillSeconds*1000*5);
 const after=economy.snapshot([{id:'viewer'}]);
 assert.equal(before.balance,50);assert.equal(before.purchases[0].status,'pending');
 assert.equal(after.balance,52);assert.equal(after.purchases[0].status,'failed');assert.equal(after.wallets.viewer.balance,rules.walletCap);
 assert.equal(after.ledger.at(-1).kind,'refund');assert.equal(economy.data.balance,52);
});

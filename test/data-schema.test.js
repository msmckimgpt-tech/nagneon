import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {EconomyData,AudienceData,KnowledgeData,ClipsData} from '../server/data-schema.js';
import {Economy} from '../server/economy.js';
import {Audience} from '../server/audience.js';
import {Clips} from '../server/clips.js';

test('persisted schemas accept initial state and reject dangerous numeric corruption',()=>{
  const e=new Economy();assert.equal(EconomyData.parse(e.data).balance,60);assert.deepEqual(AudienceData.parse(new Audience().data),{members:{},posts:[],lore:[]});assert.deepEqual(KnowledgeData.parse({}),{});
  assert.throws(()=>EconomyData.parse({...e.data,balance:-1}));assert.throws(()=>EconomyData.parse({...e.data,balance:Infinity}));assert.throws(()=>EconomyData.parse({...e.data,wallets:{momo:{balance:201,refillAt:0,lastDonationAt:0,paidUntil:0}}}));
});
test('persisted clip schema rejects cycles, missing parents and duplicate identities',()=>{
  const c=new Clips();const clip=c.create({game:'test',participants:[],messages:[],sessionId:'s',scene:'caption'});const a=c.comment(clip.id,{text:'A',name:'viewer'});c.comment(clip.id,{text:'B',name:'viewer',parentId:a.id});assert.equal(ClipsData.parse(c.data).length,1);
  const cycle=structuredClone(c.data);cycle[0].comments[0].parentId=cycle[0].comments[1].id;assert.throws(()=>ClipsData.parse(cycle));const missing=structuredClone(c.data);missing[0].comments[0].parentId=randomUUID();assert.throws(()=>ClipsData.parse(missing));assert.throws(()=>ClipsData.parse([...c.data,...c.data]));
});

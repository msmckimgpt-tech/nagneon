import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp,readFile} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ConversationJournal,JournalData,emptyJournal} from '../server/conversation-journal.js';
import {JournalStore} from '../server/journal-store.js';
import {donationMessage} from '../server/chat-attention.js';
import {liveViewerContext} from '../server/viewer-context.js';

const sessionId=randomUUID(),gift=(anonymous=true)=>donationMessage({id:randomUUID(),at:1000,personaId:'momo',name:'모모',amount:24,anonymous,text:'퍼즐 해결 축하해요'});
async function disk(){await mkdir('artifacts',{recursive:true});const dir=await mkdtemp(resolve('artifacts/donation-memory-test-'));const store=new JournalStore(dir);return {dir,store,j:new ConversationJournal(store.load(),v=>store.save(v))};}
const record=(j,m)=>j.record(m,{sessionId,witnesses:['momo','pop'],title:'첫 퍼즐 방송'});

test('gift type, amount, public identity and witness-only recall persist through immutable store restart',async()=>{
  const {dir,j}=await disk(),m=gift();record(j,m);j.pin(m.id,true);
  for(let i=0;i<40;i++)record(j,{id:randomUUID(),time:2000+i,personaId:'pop',name:'팝콘',kind:'chat',text:'평범한 다른 대화 '+i});
  const restored=new ConversationJournal(new JournalStore(dir).load());
  const e=restored.list({query:'후원'}).entries[0];assert.equal(e.id,m.id);assert.equal(e.kind,'donation');assert.deepEqual(e.donation,{amount:24,anonymous:true});assert.equal(e.pinned,true);
  const remembered=restored.recall('momo','이전 후원은 몇 포인트였나요?').find(e=>e.sourceId===m.id);assert.ok(remembered);assert.equal(remembered.speakerId,'anonymous');assert.deepEqual(remembered.donation,m.donation);
  const context=liveViewerContext({members:[{id:'momo',joinedAt:9000},{id:'new',joinedAt:9000}]},[{id:'momo',name:'새이름'},{id:'new',name:'새관객'}],[],null,{journal:restored,speech:'이전 후원 금액',now:10000});
  assert.ok(context.viewerContext.momo.recollections.some(e=>e.donation?.amount===24));assert.equal(context.viewerContext.new.recollections.length,0);
  assert.equal(restored.list({query:'24P'}).total,1);assert.equal(restored.list({query:'익명'}).total,1);
});

test('ordinary point promises and legacy untyped text are never promoted into paid events',()=>{
  const j=new ConversationJournal(),claim={id:randomUUID(),time:1000,personaId:'momo',name:'모모',kind:'chat',text:'190P 후원할게요'};record(j,claim);
  const old={...emptyJournal(),entries:[{id:randomUUID(),sessionId,at:2000,personaId:'anonymous',name:'익명의 관객',text:'20P 보냅니다',witnesses:['momo'],fictional:false,title:'이전 기록',pinned:false}]};
  const legacy=new ConversationJournal(old);assert.equal(legacy.data.entries[0].kind,undefined);assert.equal(legacy.recall('momo','20P')[0].donation,undefined);
  assert.equal(j.recall('momo','190P')[0].kind,'chat');assert.equal(j.recall('momo','190P')[0].donation,undefined);
  assert.throws(()=>record(j,{...claim,id:randomUUID(),donation:{amount:190,anonymous:false}}),/후원 기억/);
});

test('malformed gift metadata and public identity contradictions fail validation',()=>{
  for(const m of [
    {...gift(),donation:{amount:201,anonymous:true}},
    {...gift(),donation:{amount:1.5,anonymous:true}},
    {...gift(),donation:{amount:0,anonymous:true}},
    {...gift(),donation:undefined},
    {...gift(),name:'PRIVATE-DONOR',personaId:'momo'},
    {...gift(),kind:'chat'}
  ])assert.throws(()=>record(new ConversationJournal(),m));
  const j=new ConversationJournal(),m=gift();m.donation.donorId='PRIVATE-ID';record(j,m);assert.equal(JSON.stringify(j.data).includes('PRIVATE-ID'),false);assert.equal(JSON.stringify(j.recall('momo','후원')).includes('PRIVATE-ID'),false);
});

test('gift identity is idempotent but changing type, amount or anonymity under the same ID is rejected',()=>{
  const j=new ConversationJournal(),m=gift();record(j,m);const revision=j.data.revision;record(j,structuredClone(m));assert.equal(j.data.revision,revision);
  for(const patch of [{kind:'chat',donation:undefined},{donation:{amount:25,anonymous:true}},{donation:{amount:24,anonymous:false}}])assert.throws(()=>record(j,{...m,...patch}),/원문이 다릅니다/);
});

test('save callbacks, returned pages and recalled metadata cannot mutate retained gifts',()=>{
  const j=new ConversationJournal(undefined,v=>{v.entries[0].donation.amount=99;}),m=gift();record(j,m);m.donation.amount=88;
  j.list().entries[0].donation.amount=77;j.recall('momo','후원')[0].donation.amount=66;
  assert.equal(j.data.entries[0].donation.amount,24);j.pin(m.id,true);assert.equal(j.data.entries[0].donation.amount,24);
});

test('metadata is part of immutable bucket identity; index failure preserves the old gift',async()=>{
  const {dir,store,j}=await disk(),m=gift();record(j,m);const before=await readFile(store.file),old=structuredClone(j.data);
  const changed=structuredClone(old);changed.revision++;changed.entries[0].donation.amount=25;
  const save=store.index.save.bind(store.index);store.index.save=()=>{throw Error('synthetic index full');};assert.throws(()=>store.save(changed),/index full/);
  assert.deepEqual(await readFile(store.file),before);assert.deepEqual(new JournalStore(dir).load(),old);
  store.index.save=save;store.save(changed);assert.equal(new JournalStore(dir).load().entries[0].donation.amount,25);
});

test('deletion persists through restart and excludes gifts from subsequent model recall',async()=>{
  const {dir,j}=await disk(),m=gift();record(j,m);j.pin(m.id,true);j.forget([m.id]);
  const restored=new ConversationJournal(new JournalStore(dir).load());assert.equal(restored.list({query:'후원'}).total,0);assert.deepEqual(restored.recall('momo','퍼즐 후원'),[]);
});

test('publicly named gift retains the historical name and stable ID without current-name rewriting',async()=>{
  const {dir,j}=await disk(),m=gift(false);record(j,m);const e=new JournalStore(dir).load().entries[0];assert.equal(e.name,'모모');assert.equal(e.personaId,'momo');assert.deepEqual(e.donation,{amount:24,anonymous:false});assert.equal(JournalData.safeParse({version:1,revision:1,entries:[e]}).success,true);
});

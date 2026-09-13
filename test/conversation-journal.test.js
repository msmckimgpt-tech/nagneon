import {seedMetAudience} from './helpers/met-audience.js';
import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,readFile,rm} from 'node:fs/promises';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {ConversationJournal,JournalData,emptyJournal,JOURNAL_LIMIT,PIN_LIMIT} from '../server/conversation-journal.js';
import {JournalStore} from '../server/journal-store.js';
import {Studio} from '../server/studio.js';
import {startServer} from '../server/index.js';
import {defaults} from '../shared/defaults.js';
import {liveViewerContext} from '../server/viewer-context.js';
const session=randomUUID();
const message=(text,at=1000,personaId='streamer')=>({id:randomUUID(),personaId,name:personaId==='streamer'?'플레이어':'모모',text,time:at});
const record=(journal,msg,witnesses=['momo'],extra={})=>journal.record(msg,{sessionId:session,witnesses,title:'밤의 방송',...extra});
const fake=()=>({status:()=>({configured:true}),react:async()=>({observation:{game:'Just Chatting',scene:'대화',confidence:1,excitement:0,messages:[]},usage:{total_tokens:1}})});

test('journal stores exact public quotes, witnesses, fiction and idempotent source identity',()=>{
  const j=new ConversationJournal(),m={...message('우리 우주선의 이름은 밤비야'),fictional:true};record(j,m,['momo','gg','momo']);record(j,m,['momo']);assert.equal(j.data.entries.length,1);assert.deepEqual(j.data.entries[0].witnesses,['momo','gg']);assert.equal(j.recall('momo','우주선 이름')[0].fictional,true);assert.deepEqual(j.recall('new','우주선'),[]);assert.throws(()=>record(j,{...m,text:'다른 원문'}),/원문/);
});
test('failed persistence, adapter mutation, pin overflow and unknown IDs do not commit',()=>{
  let fail=false;const j=new ConversationJournal(undefined,next=>{if(next.entries[0])next.entries[0].text='adapter mutated';if(fail)throw Error('disk full');});const m=message('내가 좋아하는 퍼즐');record(j,m);assert.equal(j.data.entries[0].text,m.text);const before=structuredClone(j.data);fail=true;assert.throws(()=>j.pin(m.id,true),/disk full/);assert.throws(()=>j.forget([m.id]),/disk full/);assert.throws(()=>record(j,message('another')),/disk full/);assert.deepEqual(j.data,before);assert.throws(()=>j.pin(randomUUID(),true),/찾을/);
  const entries=Array.from({length:PIN_LIMIT+1},(_,i)=>({...j.data.entries[0],id:randomUUID(),pinned:i<PIN_LIMIT}));const full=new ConversationJournal({...emptyJournal(),entries});assert.throws(()=>full.pin(entries.at(-1).id,true),/100/);assert.equal(full.summary().pinned,PIN_LIMIT);
});
test('capacity evicts only oldest unpinned sources and preserves pinned history',()=>{
  const seed=new ConversationJournal();record(seed,message('첫 방송의 약속'));const entries=Array.from({length:JOURNAL_LIMIT},(_,i)=>({...seed.data.entries[0],id:randomUUID(),at:i,pinned:i===0}));const j=new ConversationJournal({...emptyJournal(),entries});record(j,message('새로운 말',5000));assert.equal(j.data.entries.length,JOURNAL_LIMIT);assert.equal(j.data.entries[0].id,entries[0].id);assert.ok(!j.data.entries.some(e=>e.id===entries[1].id));
});
test('old topic and its later correction are retrieved after recent history expires',()=>{
  const j=new ConversationJournal();const old=message('우리 방 구호는 별빛은 천천히 모인다야',1000);record(j,old);const correction=message('정정할게. 구호는 별빛은 함께 모인다로 바꿀게',2000);record(j,correction);for(let i=0;i<45;i++)record(j,message('잠깐 메뉴를 둘러보는 중 '+i,3000+i));const found=j.recall('momo','우리 방 구호 기억나?');assert.ok(found.some(e=>e.sourceId===old.id));assert.ok(found.some(e=>e.sourceId===correction.id));assert.ok(found.findIndex(e=>e.sourceId===old.id)<found.findIndex(e=>e.sourceId===correction.id));assert.deepEqual(j.recall('late','구호'),[]);
});

test('specific earlier personal roles outrank routine recall wording and preserve later cancellation',()=>{
  const j=new ConversationJournal(),roles=[message('저는 이번 주 작은 행복 코너요. 소소하게 좋았던 일 나눌래요.',1000,'momo'),{...message('저는 한 판 돌아보기요. 그 선택을 한 이유를 듣는 코너를 맡고 싶어요.',2000,'gg'),name:'각보는고양이'}];
  for(const m of roles)record(j,m,['momo','gg']);record(j,message('라디오 요일은 정정할게. 토요일로 바꿀게',3000),['momo','gg']);record(j,message('라디오 약속은 취소할게. 숙제처럼 하고 싶지 않아서야.',4000),['momo','gg']);
  for(let i=0;i<180;i++)record(j,message('오늘 얘기한 내용을 각자 정확하게 기억해줘. 다른 화면 메뉴 '+i,5000+i),['momo','gg']);
  for(const id of ['momo','gg']){const found=j.recall(id,'모모, 각보는고양이, 각자가 라디오에서 맡으려고 했던 코너가 뭐였지? 서로의 코너랑 섞지 말고 각자 네가 말한 내용을 기억해줘.');assert.ok(found.some(e=>e.sourceId===roles.find(m=>m.personaId===id).id));assert.ok(found.some(e=>/약속은 취소/.test(e.text)));}
});
test('viewer context excludes other witnesses, duplicate recent sources, and unsourced legacy memories',()=>{
  const j=new ConversationJournal(),past=message('라디오 약속',100),now=message('오늘의 인사',1000);record(j,past);record(j,now,['momo','new']);const a={members:[{id:'momo',joinedAt:900,memories:['출처 없는 옛말']},{id:'new',joinedAt:900,memories:[]}],eligible:['momo','new']};const context=liveViewerContext(a,[{id:'momo'},{id:'new'}],[now],null,{journal:j,speech:'라디오 약속'});assert.equal(context.viewerContext.momo.recollections[0].sourceId,past.id);assert.deepEqual(context.viewerContext.new.recollections,[]);assert.deepEqual(context.viewerContext.momo.memories,[]);assert.ok(!JSON.stringify(context).includes('출처 없는 옛말'));j.forget([past.id]);assert.deepEqual(j.recall('momo','라디오 약속').filter(e=>e.sourceId===past.id),[]);
});
test('query paging is bounded, pin filter uses full source text, and callers cannot mutate storage',()=>{
  const j=new ConversationJournal();const m=message('좋아하는 장르: 퍼즐');record(j,m);j.pin(m.id,true);const page=j.list({query:'퍼즐',viewerId:'momo',pinned:true,limit:1});assert.equal(page.total,1);page.entries[0].text='changed';assert.equal(j.data.entries[0].text,m.text);assert.equal(j.list({viewerId:'absent'}).total,0);assert.throws(()=>JournalData.parse({...emptyJournal(),entries:[{...j.data.entries[0],witnesses:['__proto__']}]}));
});
test('an old pinned promise and later cancellation both survive history expiry and fair excerpt budgeting',()=>{
  const j=new ConversationJournal(),old=message('라디오 약속은 토요일 밤이야. '+ '😀'.repeat(1000),1000);record(j,old);j.pin(old.id,true);const cancelled=message('라디오는 취소할게. 지금은 쉬고 싶어.',200000);record(j,cancelled);for(let i=0;i<50;i++)record(j,message('다른 메뉴 화면 '+i,300000+i));const quotes=j.recall('momo','토요일 라디오 약속');assert.ok(quotes.some(e=>e.sourceId===cancelled.id&&e.text===cancelled.text));assert.ok(quotes.some(e=>e.sourceId===old.id&&e.excerpt));assert.ok(quotes.reduce((n,e)=>n+e.text.length,0)<=1800);assert.ok(quotes.every(e=>e.text.isWellFormed()));
});
test('live publication records only present enabled witnesses; rehearsal and off-air actions do not record',t=>{
  const s=new Studio({provider:fake(),settings:{...defaults,mode:'live',discovery:{...defaults.discovery,enabled:false}},random:()=>0});t.after(()=>s.close());s.start();s.audience.presence.new='waiting';s.audience.presence.gg='away';const m=s.addMessage('streamer','취향은 조용한 탐험');assert.ok(s.journal.data.entries[0].witnesses.includes('momo'));assert.ok(!s.journal.data.entries[0].witnesses.includes('new'));assert.ok(!s.journal.data.entries[0].witnesses.includes('gg'));s.stop();s.addMessage('momo','방송 밖 말');assert.equal(s.journal.summary().count,1);s.configure({...s.settings,mode:'rehearsal'});s.start();s.addMessage('streamer','예시 응답');assert.equal(s.journal.summary().count,1);s.moderate('delete',m.id);assert.equal(s.journal.summary().count,0);
});
test('memory write failure remains visible and cannot pretend to have saved a published quote',t=>{
  const s=new Studio({provider:fake(),settings:{...defaults,mode:'live'},journal:new ConversationJournal(undefined,()=>{throw Error('disk full');})});t.after(()=>s.close());s.start();s.addMessage('streamer','안녕');assert.equal(s.messages.length,1);assert.equal(s.journal.summary().count,0);assert.match(s.lastError,/기억에 보관하지 못했습니다/);
});
test('real server restart, source export, pin persistence, private isolation and delete contract',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'backseat-journal-'));let service;
  try{
    service=await startServer({port:0,dataDir:dir,provider:fake(),localSpeech:false});seedMetAudience(service.studio);service.studio.configure({...service.studio.settings,mode:'live',discovery:{...defaults.discovery,enabled:false}});service.studio.start();const m=service.studio.addMessage('streamer','기억할 구호는 별빛은 함께 모인다');service.studio.journal.pin(m.id,true);const witnesses=service.studio.journal.data.entries[0].witnesses;service.studio.stop();await service.close();
    service=await startServer({port:0,dataDir:dir,provider:fake(),localSpeech:false});const headers={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'};assert.equal((await fetch(service.url+'/api/journal')).status,401);let response=await fetch(service.url+'/api/journal?viewerId=momo&pinned=true',{headers});const page=await response.json();assert.equal(page.total,1);assert.deepEqual(page.entries[0].witnesses,witnesses);assert.equal((await fetch(service.url+'/api/journal?limit=10000',{headers})).status,400);assert.equal((await (await fetch(service.url+'/api/export',{headers})).json()).conversationJournal.entries[0].id,m.id);
    service.studio.busy=true;response=await fetch(service.url+'/api/journal/'+m.id,{method:'DELETE',headers});assert.equal(response.ok,false);assert.equal(service.studio.journal.summary().count,1);service.studio.busy=false;response=await fetch(service.url+'/api/journal/'+m.id,{method:'DELETE',headers});assert.equal(response.ok,true);assert.equal(new JournalStore(dir).load().entries.length,0);
  }finally{await service?.close();await rm(dir,{recursive:true,force:true});}
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdir,mkdtemp} from 'node:fs/promises';
import {resolve} from 'node:path';
import {ConversationJournal} from '../server/conversation-journal.js';
import {JournalStore} from '../server/journal-store.js';
import {liveViewerContext} from '../server/viewer-context.js';
import {OpenAIProvider} from '../server/provider.js';
import {donationMessage} from '../server/chat-attention.js';
import {defaults} from '../shared/defaults.js';

const sessionId=randomUUID();
const word=(personaId,text,time=1000,extra={})=>({id:randomUUID(),personaId,name:personaId==='streamer'?'플레이어':personaId==='momo'?'예전모모':'팝콘',kind:personaId==='streamer'?'streamer':'chat',text,time,...extra});
const record=(j,m,witnesses=['momo','pop'])=>j.record(m,{sessionId,witnesses,title:'지난 대화'});
const context=(journal,speech,history=[])=>liveViewerContext({members:[{id:'momo',joinedAt:9000,relationship:'재방문'},{id:'pop',joinedAt:9000,relationship:'재방문'},{id:'new',joinedAt:9000,relationship:'첫 방문'}]},[{id:'momo',name:'바뀐모모'},{id:'pop',name:'팝콘'},{id:'new',name:'새관객'}],history,null,{journal,speech,now:10000});

test('restarted witness memories retain speaker roles across re-entry and rename without sharing them with newcomers',async()=>{
  await mkdir('artifacts',{recursive:true});const dir=await mkdtemp(resolve('artifacts/recall-experience-')),store=new JournalStore(dir),j=new ConversationJournal(store.load(),v=>store.save(v));
  const m=word('momo','민트초코는 좋아해요'),other=word('pop','민트초코는 싫어요',1100);record(j,m);record(j,other);
  const restored=new ConversationJournal(new JournalStore(dir).load()),packet=context(restored,'민트초코 좋아해요?');
  const recalled=(id,source)=>packet.viewerContext[id].recollections.find(e=>e.sourceId===source.id);
  assert.equal(recalled('momo',m).experience,'own-words');assert.equal(recalled('momo',other).experience,'witnessed-words');
  assert.equal(recalled('pop',m).experience,'witnessed-words');assert.equal(recalled('pop',other).experience,'own-words');
  assert.equal(recalled('momo',m).speaker,'예전모모');assert.equal(recalled('momo',m).text,m.text);
  assert.ok(recalled('momo',m).at<packet.viewerContext.momo.joinedAt);assert.deepEqual(packet.viewerContext.new.recollections,[]);
  const payload=new OpenAIProvider({}).payload({settings:defaults,history:[],speech:'민트초코 좋아해요?',...packet});
  const data=JSON.parse(payload.input[0].content[0].text);assert.equal(data.chatHistory,undefined);assert.equal(data.viewerContext.momo.recollections[0].experience,'own-words');
  assert.ok(!Object.hasOwn(restored.list().entries[0],'experience'),'role is derived per recipient, not written into shared storage');
});

test('witnessed words remain quotes, preserve fiction and STT uncertainty, and cannot inject an experience role',()=>{
  const j=new ConversationJournal(),said=word('streamer','우리 우주선 이름은 바미야',1000,{fictional:true,experience:'own-words',transcription:{source:'microphone'}});record(j,said,['momo']);
  j.annotateTranscription(said.id,{text:'우리 우주선 이름은 밤이야',confidence:.91,reason:'합성 교정',at:2000});
  const memory=context(j,'우주선 이름').viewerContext.momo.recollections.find(e=>e.sourceId===said.id);
  assert.equal(memory.experience,'witnessed-words');assert.equal(memory.speakerId,'streamer');assert.equal(memory.text,said.text);assert.equal(memory.fictional,true);
  assert.equal(memory.transcriptionCorrection.confidence,.91);assert.equal(memory.transcriptionCorrection.source,'contextual-stt');
  assert.deepEqual(context(j,'우주선 이름').viewerContext.pop.recollections,[]);
});

test('anonymous gifts keep public event identity while ordinary promises stay witnessed words',()=>{
  const j=new ConversationJournal(),gift=donationMessage({id:randomUUID(),at:1000,amount:24,anonymous:true,text:'퍼즐 축하'}),promise=word('pop','후원 190P 보낼게요',1100);record(j,gift,['momo']);record(j,promise,['momo']);
  const memories=context(j,'후원 포인트').viewerContext.momo.recollections,paid=memories.find(e=>e.sourceId===gift.id),claim=memories.find(e=>e.sourceId===promise.id);
  assert.equal(paid.experience,'witnessed-donation');assert.equal(paid.speakerId,'anonymous');assert.equal(paid.speaker,'익명의 관객');assert.deepEqual(paid.donation,{amount:24,anonymous:true});
  assert.equal(claim.experience,'witnessed-words');assert.equal(claim.donation,undefined);
  paid.donation.amount=200;assert.equal(j.recall('momo','후원').find(e=>e.sourceId===gift.id).donation.amount,24);
});

test('experience annotations do not resurrect deleted sources or duplicate recently read chat',()=>{
  const j=new ConversationJournal(),old=word('momo','라디오 좋아해요'),recent=word('streamer','라디오 얘기하자',9500);record(j,old,['momo']);record(j,recent);
  const packet=context(j,'라디오',[recent]).viewerContext.momo;
  assert.deepEqual(packet.chatHistory,[recent]);assert.ok(packet.recollections.some(e=>e.sourceId===old.id));assert.ok(!packet.recollections.some(e=>e.sourceId===recent.id));
  j.forget([old.id]);assert.deepEqual(context(j,'라디오',[recent]).viewerContext.momo.recollections,[]);
});

test('quiet witnesses can recall an elliptical follow-up without guessing facts or sharing other viewers history',()=>{
  const j=new ConversationJournal(),gift=donationMessage({id:randomUUID(),at:1000,amount:24,anonymous:true,text:'퍼즐 축하'}),promise=word('pop','다음에는 190P 보내겠어요',1100);record(j,gift,['momo']);record(j,promise,['momo']);
  const question='모모님, 팝콘님이 보낸다던 거 말고 진짜 들어온 건 얼마였지?',rows=context(j,question).viewerContext.momo.recollections;
  assert.deepEqual(rows.map(e=>e.sourceId),[gift.id,promise.id]);assert.equal(rows[0].donation.amount,24);assert.equal(rows[1].donation,undefined);
  assert.deepEqual(j.recall('new',question),[]);assert.deepEqual(j.recall('momo',''),[],'silent frames do not trigger extra fallback');
  assert.deepEqual(j.recall('momo',question,[gift.id,promise.id]),[]);j.forget([gift.id]);assert.deepEqual(j.recall('momo',question).map(e=>e.sourceId),[promise.id]);
});

test('recent fallback stays bounded and does not crowd out a specific older match',()=>{
  const j=new ConversationJournal(),specific=word('pop','서랍 비밀번호는 861이래',1000);record(j,specific,['momo']);
  for(let i=0;i<30;i++)record(j,word('pop','평범한 메뉴 구경 '+i,2000+i),['momo']);
  const relevant=j.recall('momo','서랍 비밀번호');assert.ok(relevant.some(e=>e.sourceId===specific.id));assert.ok(!relevant.some(e=>e.at>=2000));
  const fallback=j.recall('momo','그러면 어떻게 됐었죠?');assert.equal(fallback.length,3);assert.deepEqual(fallback.map(e=>e.at),[2027,2028,2029]);assert.ok(fallback.reduce((n,e)=>n+e.text.length,0)<=1800);
});

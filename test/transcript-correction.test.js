import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtemp,rm} from 'node:fs/promises';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {admitTranscriptCorrection} from '../server/transcript-correction.js';
import {ConversationJournal,emptyJournal} from '../server/conversation-journal.js';
import {JournalStore} from '../server/journal-store.js';
import {Studio} from '../server/studio.js';
import {defaults} from '../shared/defaults.js';

const raw='몬스터를 자바서 퀘스트를 끝내는 거예요.',corrected='몬스터를 잡아서 퀘스트를 끝내는 거예요.';
const proposed=text=>({text,confidence:.98,reason:'몬스터를 잡는다는 문맥의 음운이 비슷한 오인식'});
const observation=(transcriptCorrections=[])=>({game:'Synthetic',scene:'합성 테스트',confidence:.8,excitement:.2,transcriptCorrections,messages:[{personaId:'momo',text:'오 하나 끝났네요 ㅎㅎ',kind:'chat',spoiler:false}]});
function make(t,{react,journal,enabled=true}={}){let calls=0;const s=new Studio({settings:{...defaults,mode:'live',lurkRatio:0,contextualTranscription:enabled},now:()=>100000,random:()=>.5,journal,provider:{status:()=>({configured:true}),react:async args=>{calls++;return {observation:await react(args)};}}});clearInterval(s.timer);s.start();t.after(()=>s.close());return {s,calls:()=>calls};}
const receive=(s,text=raw,source='microphone')=>{const body={id:randomUUID(),sessionId:s.sessionId,text,source};return {body,...s.receiveSpeech(body)};};

test('contextual correction admits close Korean spelling and spacing while preserving intent',()=>{
  assert.equal(admitTranscriptCorrection(raw,proposed(corrected)),true);
  assert.equal(admitTranscriptCorrection('오늘은 같이하고 싶어요.',proposed('오늘은 같이 하고 싶어요.')),true);
  for(const [before,after] of [['포인트 30개를 썼어요.','포인트 300개를 썼어요.'],['훈수는 하지 말아 주세요.','훈수를 해 주세요.'],['몬스터를 못 잡았어요.','몬스터를 잡았어요.'],['이게 보스인가요?','이게 보스인가요.'],['오늘은 게임을 해요.','오늘은 친구와 바다에 가서 여행하고 싶어요.']])assert.equal(admitTranscriptCorrection(before,proposed(after)),false,before);
  assert.equal(admitTranscriptCorrection(raw,{...proposed(corrected),confidence:.7}),false);
  assert.equal(admitTranscriptCorrection(raw,proposed(raw)),false);
});

test('one audience call annotates microphone text without overwriting the original or duplicating retries',async t=>{
  let payload;const {s,calls}=make(t,{react:args=>{payload=args;return observation([{messageId:args.transcriptCandidates[0].messageId,...proposed(corrected)}]);}});
  const input=receive(s);assert.equal(s.messages[0].text,raw);await s.react({});
  assert.equal(calls(),1);assert.equal(payload.transcriptCandidates[0].text,raw);assert.equal(s.messages[0].text,raw);assert.equal(s.messages[0].transcription.correction.text,corrected);
  const remembered=s.journal.data.entries[0];assert.equal(remembered.text,raw);assert.equal(remembered.transcription.correction.text,corrected);assert.equal(s.speechInbox.pending.length,0);
  s.receiveSpeech(input.body);assert.equal(s.messages.filter(m=>m.kind==='streamer').length,1);assert.throws(()=>s.receiveSpeech({...input.body,source:'keyboard'}),/달라졌/);
  const recalled=s.journal.recall('momo','몬스터를 잡아서')[0];assert.equal(recalled.text,raw);assert.equal(recalled.transcriptionCorrection.text,corrected);
});

test('keyboard input, disabled correction, and unrelated source IDs cannot be rewritten',async t=>{
  for(const [source,enabled] of [['keyboard',true],['microphone',false]]){
    const {s}=make(t,{enabled,react:args=>{assert.deepEqual(args.transcriptCandidates,[]);return observation([{messageId:s.messages[0].id,...proposed(corrected)}]);}});
    receive(s,raw,source);await s.react({});assert.equal(s.messages[0].transcription?.correction,undefined);assert.equal(s.messages[0].text,raw);
  }
  const {s}=make(t,{react:()=>observation([{messageId:randomUUID(),...proposed(corrected)}])});receive(s);await s.react({});assert.equal(s.messages[0].transcription.correction,undefined);
});

test('meaning-changing correction cannot publish a reply based on its invented interpretation',async t=>{
  const {s}=make(t,{react:args=>observation([{messageId:args.transcriptCandidates[0].messageId,...proposed('포인트 300개를 썼어요.')}])});receive(s,'포인트 30개를 썼어요.');
  const result=await s.react({});assert.equal(result.transcriptionNeedsReview,true);assert.equal(s.queue.length,0);assert.equal(s.messages[0].text,'포인트 30개를 썼어요.');assert.equal(s.messages[0].transcription.correction,undefined);
});

test('annotation-only commits persist in immutable journal buckets and preserve original provenance',async t=>{
  const dir=await mkdtemp(join(tmpdir(),'backseat-transcript-'));t.after(()=>rm(dir,{recursive:true,force:true}));const store=new JournalStore(dir),journal=new ConversationJournal(emptyJournal(),value=>store.save(value));
  const id=randomUUID(),sessionId=randomUUID();journal.record({id,personaId:'streamer',name:'방장',time:1000,text:raw,transcription:{source:'microphone'}},{sessionId,witnesses:['momo'],title:'방송'});const before={...store.current.chunks};
  const correction={...proposed(corrected),at:2000};journal.annotateTranscription(id,correction);assert.notDeepEqual(store.current.chunks,before);
  const loaded=new ConversationJournal(new JournalStore(dir).load());assert.equal(loaded.data.entries[0].text,raw);assert.deepEqual(loaded.data.entries[0].transcription.correction,correction);assert.equal(loaded.list({query:'잡아서'}).total,1);
  const copy=loaded.list({}).entries[0];copy.transcription.correction.text='tampered';assert.equal(loaded.data.entries[0].transcription.correction.text,corrected);
  assert.equal(loaded.annotateTranscription(id,{...correction,text:'second rewrite'}),false);
});

test('failed annotation storage retains the exact source and suppresses the dependent reply',async t=>{
  const journal=new ConversationJournal();const {s}=make(t,{journal,react:args=>observation([{messageId:args.transcriptCandidates[0].messageId,...proposed(corrected)}])});receive(s);journal.save=()=>{throw new Error('disk full');};
  const result=await s.react({});assert.equal(result.transcriptionNeedsReview,true);assert.equal(journal.data.entries[0].text,raw);assert.equal(journal.data.entries[0].transcription.correction,undefined);assert.equal(s.messages[0].transcription.correction,undefined);assert.equal(s.queue.length,0);
});

test('unchanged proposals are harmless while deleted speech cannot return through a late correction',async t=>{
  const same=make(t,{react:args=>observation([{messageId:args.transcriptCandidates[0].messageId,...proposed(raw)}])});receive(same.s);assert.equal((await same.s.react({})).ok,true);assert.ok(same.s.queue.length);assert.equal(same.s.messages[0].transcription.correction,undefined);
  let finish;const late=make(t,{react:args=>new Promise(resolve=>finish=()=>resolve(observation([{messageId:args.transcriptCandidates[0].messageId,...proposed(corrected)}])))});
  const input=receive(late.s),job=late.s.react({});late.s.moderate('delete',input.messageId);finish();assert.equal((await job).transcriptionNeedsReview,true);assert.equal(late.s.queue.length,0);assert.equal(late.s.journal.data.entries.length,0);
});

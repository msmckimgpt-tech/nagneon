import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ConversationJournal} from '../server/conversation-journal.js';
import {liveViewerContext} from '../server/viewer-context.js';

const sessionId=randomUUID();
function fixture(){
 const journal=new ConversationJournal();let now=1000;
 const add=(text,options={})=>{
  const {personaId='streamer',witnesses=['momo','pop'],session=sessionId,at=now++,fictional=false,transcription}=options;
  const message={id:randomUUID(),time:at,personaId,name:personaId==='streamer'?'플레이어':personaId,text,kind:personaId==='streamer'?'streamer':'chat',fictional,...(transcription?{transcription}:{})};
  journal.record(message,{sessionId:session,witnesses,title:'대화 회귀'});return message;
 };
 return {journal,add};
}

test('a returning viewer receives the natural self-correction alongside the old appointment',()=>{
 const {journal,add}=fixture();
 const old=add('모모, 다음 금요일 저녁 여덟 시에 추리게임 같이 해보자.');
 add('좋아요, 다음 금요일 저녁 여덟 시!',{personaId:'momo'});
 const repair=add('아 아니다. 토요일 아홉 시야. 내가 날짜랑 시간을 헷갈렸네.');
 add('토요일 아홉 시! 그때 봐요.',{personaId:'momo'});
 for(let i=0;i<50;i++)add('오늘은 쉬면서 음악 듣기 '+i);
 const restored=new ConversationJournal(structuredClone(journal.data));
 const packet=liveViewerContext({members:[{id:'momo',joinedAt:90000}]},[{id:'momo',name:'바뀐모모'}],[],null,{journal:restored,speech:'모모, 다음 금요일에 추리게임 몇 시였지?',now:100000}).viewerContext.momo;
 const original=packet.recollections.find(e=>e.sourceId===old.id),corrected=packet.recollections.find(e=>e.sourceId===repair.id);
 assert.equal(original?.text,old.text);assert.equal(corrected?.text,repair.text);
 assert.equal(corrected.experience,'witnessed-words');assert.ok(corrected.at>original.at);
 assert.equal(restored.data.entries.find(e=>e.id===old.id).text,old.text,'do not rewrite the original');
});

test('crowd chatter and a full recall budget do not separate a quote from its correction chain',()=>{
 const {journal,add}=fixture();
 const old=add('달빛 퍼즐 약속 금요일 여덟 시',{personaId:'momo'});
 for(let i=0;i<12;i++)add('ㅋㅋ 구경중 '+i,{personaId:'pop'});
 const repair=add('아니, 토요일 아홉 시요.',{personaId:'momo'});
 const latest=add('아냐, 열 시예요. 제가 잘못 말했어요.',{personaId:'momo'});
 for(let i=0;i<12;i++){const m=add('달빛 퍼즐 좋아하는 약속 '+i,{personaId:i%2?'pop':'streamer'});if(i===8)journal.pin(m.id,true);}
 add('산책은 취소할게.');add('청소는 정정할게.');
 const found=journal.recall('momo','달빛 퍼즐 약속 금요일 여덟 시');
 assert.ok(found.some(e=>e.sourceId===old.id));assert.ok(found.some(e=>e.sourceId===repair.id));assert.ok(found.some(e=>e.sourceId===latest.id));
 assert.ok(found.length<=8);assert.ok(found.reduce((n,e)=>n+e.text.length,0)<=1800);
});

test('continuations preserve witness, recent-history, fiction, session, time and intervening-turn boundaries',()=>{
 const cases=[
  {name:'unheard',options:{witnesses:['pop']}},
  {name:'different session',options:{session:randomUUID()}},
  {name:'fiction',options:{fictional:true}},
  {name:'backdated',options:{at:999}},
  {name:'too late',options:{at:121001}},
  {name:'different speaker',options:{personaId:'pop'}},
  {name:'recently supplied',exclude:true},
  {name:'intervening own turn',intervening:true},
  {name:'backdated second repair',intermediateRepair:true,options:{at:2000}},
 ];
 for(const c of cases){
  const {journal,add}=fixture();const old=add('금요일 별 관찰 약속 여덟 시');
  if(c.intervening)add('저녁 메뉴는 나중에 이야기하자.',{witnesses:['pop']});
  if(c.intermediateRepair)add('아니, 주말 낮으로 할까.',{at:3000});
  const repair=add('아 아니다. 토요일 아홉 시.',c.options);
  for(let i=0;i<5;i++)add('다른 취미 소개 '+i);
  const found=journal.recall('momo','별 관찰 약속',c.exclude?[repair.id]:[]);
  assert.ok(found.some(e=>e.sourceId===old.id),c.name);
  assert.ok(!found.some(e=>e.sourceId===repair.id),c.name);
 }
});

test('repair retrieval retains uncertainty and deletion without inventing a resolved fact',()=>{
 const {journal,add}=fixture();const old=add('주말 독서 약속은 금요일');
 const repair=add('아 아니다. 토요일 일곱 시.',{transcription:{source:'microphone'}});
 journal.annotateTranscription(repair.id,{text:'아, 아니다. 토요일 일곱 시.',confidence:.95,reason:'띄어쓰기',at:2000});
 const quotes=journal.recall('momo','주말 독서 약속');
 const found=quotes.find(e=>e.sourceId===repair.id);
 assert.equal(found?.text,repair.text);assert.equal(found.transcriptionCorrection.source,'contextual-stt');
 assert.deepEqual(journal.recall('new','주말 독서 약속'),[]);
 journal.forget([repair.id]);assert.ok(!journal.recall('momo','주말 독서 약속').some(e=>e.sourceId===repair.id));
 assert.equal(journal.data.entries.find(e=>e.id===old.id).text,old.text);
});

test('a recalled public question retains nearby witnessed answers even when the answer omits its topic',()=>{
 const {journal,add}=fixture();
 add('팝콘도둑은 영화 볼 때 어떤 야식 먹어? 나는 군만두파야.');
 const pop=add('저는 버터팝콘! 영화보다 먼저 다 먹어요.',{personaId:'pop'});
 const question=add('모모는? 네가 먹고 싶은 야식 골라봐.');
 const momo=add('저는 떡볶이요! 달짝지근한 걸로요.',{personaId:'momo'});
 add('나 오늘 만두 한쪽 태워먹음.');
 for(let i=0;i<30;i++)add('다른 이야기 구경 '+i);
 const found=journal.recall('pop','팝콘도둑, 모모가 각각 무슨 야식을 골랐지?');
 for(const source of [pop,question,momo])assert.ok(found.some(e=>e.sourceId===source.id));
 const context=liveViewerContext({members:[{id:'pop',joinedAt:90000}]},[{id:'pop'}],[],null,{journal,speech:'모모 야식',now:100000}).viewerContext.pop;
 assert.equal(context.recollections.find(e=>e.sourceId===momo.id).experience,'witnessed-words');
});

test('question context never bridges a new streamer turn, session, fiction, lost witness or expired window',()=>{
 for(const c of [{name:'new turn',intervening:true},{name:'new session',options:{session:randomUUID()}},{name:'fiction',options:{fictional:true}},{name:'unheard',options:{witnesses:['momo']}},{name:'expired',options:{at:92000}},{name:'backdated',options:{at:999}},{name:'recent',exclude:true}]){
  const {journal,add}=fixture();add('모모는 야식 뭐 골랐어?');
  if(c.intervening)add('이제 산책 이야기하자.',{witnesses:['momo']});
  const answer=add('저는 떡볶이요.',{personaId:'momo',...c.options});
  const found=journal.recall('pop','야식',c.exclude?[answer.id]:[]);
  assert.ok(!found.some(e=>e.sourceId===answer.id),c.name);
 }
});

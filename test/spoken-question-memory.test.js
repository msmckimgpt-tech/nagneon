import test from 'node:test';
import {randomUUID} from 'node:crypto';
import assert from 'node:assert/strict';
import {ConversationJournal} from '../server/conversation-journal.js';
import {conversationRhythm,isChatQuestion} from '../server/conversation-rhythm.js';

const questions=[
 '모모는 야식 뭐 먹을래', '여러분은 어떤 장르 좋아해요', '이 게임 어때',
 '다음 방송 몇 시에 시작하지', '오늘은 누가 먼저 할 거야', '퍼즐은 어디로 가야 돼',
 '이거 어떻게 하는 거야', '언제 다시 올 거예요', '모모는 어느 쪽이 좋아 ㅋㅋ',
 '다음에는 뭘 할까', '그 기술 왜 쓰는 거야', '팝콘님은 얼마나 걸렸어',
 '누구랑 같이 갈래', '여러분 이 의상 어떰 ㅎㅎ',
];
const statements=[
 '난 오늘 떡볶이 먹을래', '어떤 게임이든 좋아요', '뭐 먹을지 모르겠네',
 '왜 그러는지 이제 알겠어', '어떻게 하는지 알려줄게', '어디로 가야 하는지 고민 중',
 '누가 먼저 할 거야라고 물었어', '게임 어때라는 질문은 나중에',
 '오늘 몇 시에 시작하는지 확인했어', '언제 다시 올지 아직 몰라',
 '얼마나 걸렸는지 기억 안 나', '뭐야 대박이다', '아무거나 해도 좋아',
 '누가 봐도 잘했어', '누구나 할 수 있어', '언제나 응원할 거야',
 '어떤 메뉴라도 좋아', '어느 쪽이든 괜찮아', '왜냐하면 내가 먼저 했어',
 '뭘 할지 모르겠어요', '언제 다시 올지 아직 몰라요', '누가 할지 알아',
];

test('unpunctuated Korean questions remain questions without promoting reported or uncertain statements',()=>{
 for(const text of questions)assert.equal(isChatQuestion(text),true,text);
 for(const text of statements)assert.equal(isChatQuestion(text),false,text);
});

test('spoken question retrieves the witnessed short answer after restart without rewriting STT',()=>{
 const journal=new ConversationJournal();let time=1000;const sessionId=randomUUID(),ids=new Map();
 const add=(id,text,personaId='streamer',witnesses=['momo','pop'])=>journal.record({id:(ids.set(id,randomUUID()),ids.get(id)),time:time++,text,personaId,name:personaId,kind:personaId==='streamer'?'streamer':'chat',...(personaId==='streamer'?{transcription:{source:'microphone'}}:{})},{sessionId,witnesses});
 add('question','모모는 야식 뭐 먹을래');add('answer','저는 떡볶이요','momo');
 for(let i=0;i<40;i++)add('filler-'+i,'산책 이야기 '+i);
 const restored=new ConversationJournal(structuredClone(journal.data));
 const found=restored.recall('pop','모모 야식');
 assert.equal(found.find(e=>e.sourceId===ids.get('answer'))?.text,'저는 떡볶이요');
 assert.equal(found.find(e=>e.sourceId===ids.get('question'))?.text,'모모는 야식 뭐 먹을래');
 assert.deepEqual(restored.recall('late','모모 야식'),[]);
 restored.forget([ids.get('answer')]);assert.ok(!restored.recall('pop','모모 야식').some(e=>e.sourceId===ids.get('answer')));
});

test('casual peer question keeps nearby streamer speech as a tentative thread',()=>{
 const rows=[{id:'q',text:'방장 다음엔 뭘 할까 ㅋㅋ',personaId:'pop',kind:'chat',time:1000},{id:'a',text:'다음에는 추리게임 해보자',personaId:'streamer',kind:'streamer',time:2000}];
 const result=conversationRhythm(rows,'pop',{now:3000});
 assert.equal(result.ownRecent.questions,1);
 assert.deepEqual(result.questionThreads[0].followingStreamerSpeech.map(e=>e.id),['a']);
 assert.equal(result.questionThreads[0].answered,undefined);
 assert.deepEqual(result.recentReactions,[]);
});

test('spoken-answer linking retains hearing, session, fiction, timing and recent-context boundaries',()=>{
 for(const kind of ['unheard','session','fiction','late','backdated','recent','intervening']){
  const sessionId=randomUUID(),question=randomUUID(),answer=randomUUID();
  const row=(id,text,personaId,at,extra={})=>({id,text,personaId,name:personaId,at,sessionId,kind:personaId==='streamer'?'streamer':'chat',witnesses:['pop','momo'],fictional:false,title:'합성',pinned:false,...extra});
  const entries=[row(question,'모모는 야식 뭐 먹을래','streamer',1000)];
  if(kind==='intervening')entries.push(row(randomUUID(),'산책 이야기하자','streamer',1001));
  entries.push(row(answer,'저는 떡볶이요','momo',kind==='late'?92001:kind==='backdated'?999:1002,kind==='unheard'?{witnesses:['momo']}:kind==='session'?{sessionId:randomUUID()}:kind==='fiction'?{fictional:true}:{}));
  const journal=new ConversationJournal({version:1,revision:1,entries});
  const found=journal.recall('pop','야식',kind==='recent'?[answer]:[]);
  assert.ok(found.some(e=>e.sourceId===question),kind);
  assert.ok(!found.some(e=>e.sourceId===answer),kind);
 }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ConversationJournal} from '../server/conversation-journal.js';

function fixture(){
 const journal=new ConversationJournal(),sessionId=randomUUID();let at=1000;
 const add=(text,{personaId='streamer',witnesses=['momo','pop'],time=at}={})=>{
  at=time+60000;
  const message={id:randomUUID(),time,personaId,name:personaId,text,kind:personaId==='streamer'?'streamer':'chat'};
  journal.record(message,{sessionId,witnesses,title:'합성 항구'});return message;
 };
 return {journal,add};
}
const query='호수항 금고에 다시 왔는데 암호가 기억 안 나네. 실제로 들은 사람만 기억나는 만큼 말해줘. 처음이면 모른다고 해도 돼.';

test('repeated recall questions and unrelated cancellations do not displace a witnessed topic correction',()=>{
 const {journal,add}=fixture();
 const old=add('호수항 금고의 암호를 찾았어. 붉은파도래. 지금 여기 있는 사람들만 들었겠네.');
 add('멀리 돌아가니 작은 의자가 있네. 잠깐 쉬고 싶어.');
 const corrected=add('아까 금고 암호 정정할게. 붉은파도는 옛날 암호고 지금은 노란조개래.',{time:183000,witnesses:['momo']});
 add('붉은파도는 옛 암호였구나.',{personaId:'pop'});
 add(query);
 add('처음에는 붉은파도였다가 노란조개라고 정정했어.',{personaId:'momo'});
 for(let i=0;i<45;i++)add('다른 가게 진열대 구경 '+i);
 add('골목을 다 안다는 자신감은 취소할게.');
 add(query);
 add('붉은파도는 옛날이고 노란조개라고 들었어요.',{personaId:'pop'});
 add('빨리 끝내겠다는 자신감은 취소할게.');
 for(let i=0;i<40;i++)add('음악 듣고 쉬는 중 '+i);
 const restored=new ConversationJournal(structuredClone(journal.data));
 const found=restored.recall('momo',query);
 assert.ok(found.some(row=>row.sourceId===old.id));
 assert.equal(found.find(row=>row.sourceId===corrected.id)?.text,corrected.text);
 assert.ok(found.length<=8);
 assert.ok(found.reduce((sum,row)=>sum+row.text.length,0)<=1800);
 assert.equal(restored.data.entries.find(row=>row.id===old.id).text,old.text);
 assert.ok(!restored.recall('pop',query).some(row=>row.sourceId===corrected.id),'unheard correction remains private to its witnesses');
 assert.ok(!restored.recall('momo',query,[corrected.id]).some(row=>row.sourceId===corrected.id),'already supplied recent quotes are not duplicated');
 restored.forget([corrected.id]);
 assert.ok(!restored.recall('momo',query).some(row=>row.sourceId===corrected.id));
});

test('latest relevant revisions keep chronological source text within the existing correction budget',()=>{
 const {journal,add}=fixture();
 add('독서 모임 정정할게. 화요일에 하자.');
 const revised=add('독서 모임 정정할게. 수요일에 하자.');
 const cancelled=add('독서 모임은 취소할게. 이번 주는 쉬고 싶어.');
 for(let i=0;i<8;i++)add('전혀 다른 메뉴 설정 정정할게 '+i);
 const found=journal.recall('momo','독서 모임');
 assert.equal(found.find(row=>row.sourceId===revised.id)?.text,revised.text);
 assert.equal(found.find(row=>row.sourceId===cancelled.id)?.text,cancelled.text);
 assert.ok(found.findIndex(row=>row.sourceId===revised.id)<found.findIndex(row=>row.sourceId===cancelled.id));
 assert.ok(found.length<=8);
});

test('recent cancellation fallback remains available when no correction matches the current words',()=>{
 const {journal,add}=fixture();
 add('산책 약속은 취소할게.');
 const newer=add('청소 약속 정정할게.');
 const latest=add('늦은 간식은 취소할게.');
 for(let i=0;i<40;i++)add('음악 듣는 중 '+i);
 const found=journal.recall('momo','풍경');
 assert.ok(found.some(row=>row.sourceId===newer.id));
 assert.ok(found.some(row=>row.sourceId===latest.id));
 assert.deepEqual(journal.recall('absent','풍경'),[]);
});

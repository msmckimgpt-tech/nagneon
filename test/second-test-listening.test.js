import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {defaults} from '../shared/defaults.js';
import {admitTranscriptCorrection,transcriptAnomaly} from '../server/transcript-correction.js';
import {liveViewerContext} from '../server/viewer-context.js';
import {repeatedChat} from '../server/chat-quality.js';
import {ConversationJournal} from '../server/conversation-journal.js';
import {format} from '../server/provider.js';

const obs=(text='이런 퍼즐도 느긋하게 풀면 좋죠')=>({game:'Synthetic',scene:'same scene',confidence:.9,excitement:.9,messages:[{personaId:'momo',text,kind:'chat',spoiler:false}],positiveMoment:{positive:true,impact:.99,reason:'synthetic',signature:'idle-must-not-reward',supporters:['momo']},viewerChanges:[],clipPicks:[]});
function fixture(t,react=async()=>({observation:obs()})){
  let now=100000;const requests=[];
  const s=new Studio({settings:{...defaults,mode:'live',lurkRatio:0,chatPace:8,slowModeSeconds:0,intervalSeconds:5},audience:new Audience(undefined,()=>{},()=>.5),random:()=>.5,now:()=>now,provider:{status:()=>({configured:true}),react:(args,signal)=>{requests.push(args);return react(args,signal);}}});
  clearInterval(s.timer);s.start();t.after(()=>s.close());return {s,requests,advance:ms=>now+=ms};
}
const send=(s,text,source='microphone')=>s.receiveSpeech({id:randomUUID(),sessionId:s.sessionId,text,source});
test('the model receives the same chat length and count constraints that runtime acceptance requires',()=>{
  assert.equal(format.schema.properties.messages.maxItems,8);assert.equal(format.schema.properties.messages.items.properties.text.maxLength,240);
});

test('correction preserves uncertainty, affect, laughter and register even when spelling is close',()=>{
  const proposal=text=>({text,confidence:.99,reason:'합성 교정 후보'});
  for(const [a,b] of [['그 선택 좋아요','그 선택 싫어요'],['오늘은 제가 할까','오늘은 제가 할게'],['아마 제가 해요','제가 해요'],['그거 좋아요 하하','그거 좋아요'],['이거 제가 합니다','이거 제가 해요'],['마스터를 자바서 이제 힘을 하려면 밥을 먹어요','마스터를 잡아서 이제 게임을 하려면 밥을 먹어요']])assert.equal(admitTranscriptCorrection(a,proposal(b)),false,a);
  assert.equal(admitTranscriptCorrection('몹을 자바서 끝내요',proposal('몹을 잡아서 끝내요')),true);
});

test('decoder loops remain in original history but cannot confuse live reactions or future recall',async t=>{
  const f=fixture(t),loop='설명을 이어갈게요 '+Array(25).fill('7.').join(' ');
  assert.ok(transcriptAnomaly(loop));assert.equal(transcriptAnomaly('하하하하 좋아요 7 7'),null);
  const receipt=send(f.s,loop);send(f.s,'이제 상점에 갈게요');const result=await f.s.react({});
  assert.equal(result.transcriptionNeedsReview,true);assert.equal(f.requests.length,0);assert.equal(f.s.messages[0].text,loop);assert.equal(f.s.speechInbox.pending.length,1);
  f.advance(3000);await f.s.react({});assert.equal(f.requests.length,1);assert.equal(f.requests[0].speech,'이제 상점에 갈게요');
  for(const p of Object.values(f.requests[0].viewerContext)){assert.ok(!p.chatHistory.some(m=>m.id===receipt.messageId));assert.ok(!p.recollections.some(m=>m.sourceId===receipt.messageId));}
  const typed=fixture(t);send(typed.s,loop,'keyboard');await typed.s.react({});assert.equal(typed.requests.length,1,'intentional keyboard repetition is not an ASR anomaly');
});

test('same-screen companionship has a bounded opportunity without visual inventions, rewards or replay loops',async t=>{
  const f=fixture(t);send(f.s,'요즘은 퍼즐을 천천히 풀 때가 좋아요');await f.s.react({image:'same'});f.advance(2000);f.s.pump();const before=structuredClone(f.s.observation),balance=structuredClone(f.s.economy.data);
  f.advance(58000);assert.equal((await f.s.react({image:'same'})).skipped,'unchanged-input');f.advance(5000);await f.s.react({image:'same'});
  const req=f.requests.at(-1);assert.equal(req.ambient.idle,true);assert.equal(req.image,undefined);assert.deepEqual(req.frames,[]);assert.equal(req.voiceCues,null);
  assert.deepEqual(f.s.observation,before);assert.deepEqual(f.s.economy.data,balance);assert.ok(f.s.queue.length<=1);assert.ok(f.s.queue.every(m=>m.chatDriven));
  f.advance(2000);f.s.pump();f.advance(58000);await f.s.react({image:'same'});assert.equal(f.requests.length,2,'idle opportunity has independent cooldown even after a reply');
});

test('quiet requests suppress idle attempts and ordinary similar words do not mute conversation',async t=>{
  const f=fixture(t);send(f.s,'잠깐 조용히 봐주세요');await f.s.react({image:'same'});f.advance(2000);f.s.pump();f.advance(120000);assert.equal((await f.s.react({image:'same'})).skipped,'unchanged-input');assert.equal(f.requests.length,1);
  send(f.s,'다시 같이 얘기해요');await f.s.react({image:'same'});assert.equal(f.s.ambient.snapshot().quiet,false);
  const g=fixture(t);g.s.ambient.context('그만큼 재밌어요');assert.equal(g.s.ambient.snapshot().quiet,false);
});

test('changing samples allow bounded company while retaining current video and later speech priority',async t=>{
  const f=fixture(t,async args=>({observation:{...obs(),scene:args.image||'no image',messages:[]}}));
  const sourceId=randomUUID(),video=i=>({sessionId:f.s.sessionId,sourceId,frames:[{image:'animation-'+i,at:f.s.now()}]});
  send(f.s,'오늘은 천천히 같이 봐요');await f.s.react({video:video(0)});
  for(let i=1;i<=4;i++){f.advance(15000);await f.s.react({video:video(i)});}
  const req=f.requests.at(-1);assert.equal(req.ambient.watching,true);assert.equal(req.ambient.idle,false);
  assert.equal(req.image,'animation-4');assert.equal(req.frames.at(-1).image,'animation-4');assert.equal(req.screenTimeline.sourceId,sourceId);
  assert.equal(f.s.observation.scene,'animation-4','fresh observation is not discarded for company');
  f.advance(15000);await f.s.react({video:video(5)});assert.notEqual(f.requests.at(-1).ambient?.id,'quiet-company');
  // A new complete utterance uses the normal conversation path immediately.
  f.advance(100000);send(f.s,'팝콘도둑은 오늘 기분 어때요?');await f.s.react({video:video(6)});
  assert.equal(f.requests.at(-1).speech,'팝콘도둑은 오늘 기분 어때요?');assert.notEqual(f.requests.at(-1).ambient?.id,'quiet-company');
});

test('animated-screen company respects quiet requests and requires actual prior conversation',async t=>{
  const f=fixture(t,async()=>({observation:{...obs(),messages:[]}}));
  await f.s.react({image:'a'});f.advance(120000);await f.s.react({image:'b'});assert.equal(f.requests.at(-1).ambient,null);
  send(f.s,'잠깐 조용히 봐주세요');f.advance(5000);await f.s.react({image:'c'});f.advance(120000);await f.s.react({image:'d'});
  assert.equal(f.requests.at(-1).ambient.quiet,true);assert.notEqual(f.requests.at(-1).ambient.id,'quiet-company');
  send(f.s,'다시 같이 얘기해요');f.advance(5000);await f.s.react({image:'e'});f.advance(65000);await f.s.react({image:'f'});
  assert.equal(f.requests.at(-1).ambient.watching,true);
});

test('idle conversation survives the visual deadline because it did not observe that video',async t=>{
  const f=fixture(t,args=>{if(args.ambient?.idle)f.advance(21000);return Promise.resolve({observation:obs(args.ambient?.idle?'저는 이런 작은 퍼즐이 좋더라고요':'천천히 해봐요')});});
  const sourceId=randomUUID(),video=()=>({sessionId:f.s.sessionId,sourceId,frames:[{image:'data:image/png;base64,c3ludGhldGlj',at:f.s.now()}]});
  send(f.s,'퇴근하면 퍼즐 풀며 쉬는 게 좋아요');await f.s.react({video:video()});f.advance(2000);f.s.pump();f.advance(65000);
  const before=structuredClone(f.s.observation),result=await f.s.react({video:video()});
  assert.equal(f.requests.at(-1).ambient.idle,true);assert.deepEqual(f.requests.at(-1).frames,[]);assert.equal(result.ok,true);
  assert.deepEqual(f.s.observation,before);assert.equal(f.s.queue.length,1);assert.equal(f.s.queue[0].chatDriven,true);assert.equal(f.s.queue[0].screenSourceId,undefined);
});

test('explicit outcome supersedes stale in-flight advice while preserving all speech for the next call',async t=>{
  let finish,signal;const f=fixture(t,(_args,s)=>{signal=s;return new Promise(r=>finish=r);});
  send(f.s,'아직 열쇠를 찾는 중이에요');const job=f.s.react({image:'same'});f.advance(3000);send(f.s,'어? 찾았어요!');assert.equal(signal.aborted,true);finish({observation:obs('열쇠 찾을 때까지 기다려요')});assert.equal((await job).skipped,'superseded');assert.equal(f.s.queue.length,0);assert.equal(f.s.speechInbox.pending.length,2);
  f.s.provider.react=async args=>{assert.match(args.speech,/찾는 중/);assert.match(args.speech,/찾았어요/);return {observation:obs('오 찾았다!')};};await f.s.react({image:'same'});assert.equal(f.s.speechInbox.pending.length,0);assert.equal(f.s.queue[0].text,'오 찾았다!');
});

test('ordinary continuing narration does not repeatedly cancel an audience response',async t=>{
  let finish,signal;const f=fixture(t,(_args,s)=>{signal=s;return new Promise(r=>finish=r);});send(f.s,'이 조합을 설명할게요');const job=f.s.react({});send(f.s,'먼저 무기를 고르고');assert.equal(signal.aborted,false);finish({observation:obs()});await job;assert.equal(f.s.speechInbox.pending.length,1);
});

test('streamer phrasing is joined from witnessed fragments, preserves jokes, and disappears with its source',()=>{
  const rows=[{id:'a',kind:'streamer',personaId:'streamer',time:1000,text:'여러분 저만 믿으세요'},{id:'b',kind:'streamer',personaId:'streamer',time:2000,text:'하하 농담이에요'},{id:'c',kind:'streamer',personaId:'streamer',time:4000,text:'다음 장면으로 가요'}];
  const context=history=>liveViewerContext({members:[{id:'early',joinedAt:0},{id:'late',joinedAt:3000}]},[{id:'early'},{id:'late'}],history,null,{now:5000}).viewerContext;
  assert.equal(context(rows).early.streamerExpression.recentPhrasing[0].text,'여러분 저만 믿으세요\n하하 농담이에요\n다음 장면으로 가요');assert.deepEqual(context(rows).late.streamerExpression.recentPhrasing[0].sourceIds,['c']);assert.deepEqual(context([]).early.streamerExpression.recentPhrasing,[]);
});

test('same viewer near-paraphrases are suppressed while new numbers, polarity and collective short cheers survive',()=>{
  const prior={personaId:'momo',kind:'chat',time:1000,text:'저는 퍼즐 푸는 얘기는 자신 있죠'};
  assert.equal(repeatedChat({personaId:'momo',text:'저는 퍼즐 푸는 얘기는 진심이죠'},[prior],13000),true);
  assert.equal(repeatedChat({personaId:'momo',text:'그런데 저는 퍼즐 푸는 걸 싫어해요'},[prior],13000),false);
  assert.equal(repeatedChat({personaId:'momo',text:'저는 이런 방식의 퍼즐 풀이가 싫어요'},[{...prior,text:'저는 이런 방식의 퍼즐 풀이가 좋아요'}],13000),false);
  assert.equal(repeatedChat({personaId:'pop',text:'ㅋㅋㅋ'},[{...prior,text:'ㅋㅋㅋ'}],2000),false);
});

test('who recommended a compound-named build retrieves its original witnessed vote amid later discussion',()=>{
  const journal=new ConversationJournal(),sessionId=randomUUID();let time=1000;
  const add=(personaId,text,witnesses=['listener'])=>{const id=randomUUID();journal.record({id,personaId,name:personaId,text,time:time+=1000,kind:'chat'},{sessionId,witnesses});return id;};
  const vote=add('voter','저라면 장창 한 표요. 길게 찌르는 맛이 좋아요.');
  for(let i=0;i<80;i++)add('listener','장창 빌드 진행 상황 '+i);
  add('unseen','장창 추천해요',[]);
  assert.ok(journal.recall('listener','아까 장창빌드 추천해 주신 분 누구죠?').some(e=>e.sourceId===vote));assert.deepEqual(journal.recall('newcomer','장창빌드 추천 누가?'),[]);
  journal.forget([vote]);assert.ok(!journal.recall('listener','장창빌드 추천 누구?').some(e=>e.sourceId===vote));
});

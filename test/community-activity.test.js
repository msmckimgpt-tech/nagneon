import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {Clips} from '../server/clips.js';
import {defaults} from '../shared/defaults.js';
import {AudienceData,ClipsData} from '../server/data-schema.js';
import {COMMUNITY_HOUR,COMMUNITY_COOLDOWN,COMMUNITY_HOURLY_LIMIT} from '../server/community-activity.js';
import {startServer} from '../server/index.js';

const T=Date.now(),member=()=>({sessions:1,seconds:60,recognized:0,affinity:.3,peers:{},memories:[]});
const output=(messages=[],communityVotes=[])=>({observation:{messages,communityVotes},usage:{total_tokens:10}});
const reply=(text,replyTo=null)=>({personaId:'momo',text,kind:'chat',spoiler:false,replyTo});
function fixture(t,react=async()=>output(),stored={}){
 let now=stored.now||T,calls=0,last;
 const audience=new Audience(stored.audience||{members:{momo:member(),luna:member()},posts:[],lore:[]});
 const clips=new Clips({data:stored.clips||[],now:()=>now,save:v=>ClipsData.parse(v)});
 const s=new Studio({audience,clips,settings:{...defaults,personas:defaults.personas.filter(p=>['momo','luna'].includes(p.id)),mode:'live'},now:()=>now,random:()=>0,provider:{status:()=>({configured:true}),react:(a,signal)=>{calls++;last=a;return react(a,signal);}}});
 clearInterval(s.timer);t.after(()=>s.close());
 const visit=async(ms=60001)=>{now+=ms;s.pump();await s.communityActivity.active?.promise;};
 const clip=()=>clips.create({title:'처음 푼 퍼즐',game:'퍼즐',scene:'마지막 조각을 맞췄다',participants:[],messages:[{id:randomUUID(),personaId:'streamer',name:'방장',kind:'streamer',text:'드디어 맞췄다',time:now}],sessionId:randomUUID(),source:'spectator'});
 return {s,clips,clip,visit,setNow:value=>now=value,get now(){return now;},get calls(){return calls;},get last(){return last;}};
}
test('automatic silent clip reading and recommendation persist without manufacturing a comment or exposing the reader',async t=>{
 const f=fixture(t,async()=>output([],[{personaId:'momo',recommended:true}])),c=f.clip();
 await f.visit();assert.equal(f.calls,1);assert.equal(f.clips.get(c.id).comments.length,0);assert.deepEqual(f.clips.get(c.id).votes,['momo']);
 assert.equal(f.clips.data[0].readings[0].viewerId,'momo');assert.equal(f.clips.data[0].activityReads[0].viewerId,'momo');ClipsData.parse(f.clips.data);AudienceData.parse(f.s.audience.data);
 assert.ok(f.clips.recall('momo','드디어').flatMap(c=>c.items).some(m=>m.text==='드디어 맞췄다'));
 for(const publicValue of [f.clips.get(c.id),f.clips.list(),f.s.state()])assert.ok(!JSON.stringify(publicValue).includes('activityReads'));
 assert.equal(f.s.state().audience.communityActivity,undefined);
 const next=fixture(t,async()=>output(),{audience:structuredClone(f.s.audience.data),clips:structuredClone(f.clips.data),now:f.now});await next.visit(COMMUNITY_COOLDOWN+1);assert.equal(next.calls,0);
});
test('the model chooses its own reply target; its own comment does not trigger a revisit',async t=>{
 const f=fixture(t,async a=>output([reply('한 조각 때문에 고생했네 ㅋㅋ',a.special.clip.comments.at(-1)?.id||null)])),c=f.clip();
 const parent=f.clips.comment(c.id,{name:'방장',text:'바로 앞에 있었는데 놓쳤네'});
 await f.visit();assert.equal(f.clips.get(c.id).comments.at(-1).parentId,parent.id);
 await f.visit(COMMUNITY_COOLDOWN+1);assert.equal(f.calls,1);
 f.clips.comment(c.id,{name:'방장',text:'다음에도 퍼즐 해볼까요?'});await f.visit(60001);assert.equal(f.calls,2);
});
test('gallery silent reading, no-vote choice and private receipt are committed together',async t=>{
 const f=fixture(t),p=f.s.community.post({title:'일정',text:'내일 쉬어요'});await f.visit();
 const raw=f.s.audience.data.posts[0];assert.equal(raw.comments.length,0);assert.equal(raw.votes.length,0);assert.equal(raw.activityReads[0].viewerId,'momo');AudienceData.parse(f.s.audience.data);
 assert.equal(f.s.community.get(p.id).activityReads,undefined);assert.ok(!JSON.stringify(f.s.state()).includes('activityReads'));await f.visit(COMMUNITY_COOLDOWN+1);assert.equal(f.calls,1);
});
test('gallery comments and votes roll back if durable save fails; attempts survive to throttle retry',async t=>{
 const f=fixture(t,async()=>{f.s.audience.save=()=>{throw Error('synthetic commit failure');};return output([reply('푹 쉬어요')],[{personaId:'momo',recommended:true}]);});
 f.s.community.post({title:'일정',text:'내일 쉬어요'});await f.visit();const p=f.s.audience.data.posts[0];
 assert.equal(p.comments.length,0);assert.equal(p.votes.length,0);assert.equal(p.activityReads,undefined);assert.equal(f.s.audience.data.communityActivity.attempts.length,1);assert.match(f.s.communityActivity.lastError,/commit failure/);assert.equal(f.s.busy,false);
});
test('deleting a read source while inference runs discards the whole comment, recommendation and receipt',async t=>{
 let finish;const f=fixture(t,()=>new Promise(r=>finish=r)),c=f.clip();const p=f.clips.comment(c.id,{name:'방장',text:'지울 말'});
 const visit=f.visit();f.clips.removeComment(c.id,p.id);finish(output([reply('늦은 댓글')],[{personaId:'momo',recommended:true}]));await visit;
 assert.equal(f.clips.get(c.id).comments.length,1);assert.equal(f.clips.data[0].readings,undefined);assert.equal(f.clips.data[0].activityReads,undefined);assert.equal(f.clips.data[0].votes,undefined);
});
test('only witnessed public dialogue can become an autonomous after-stream post, once per viewer and session',async t=>{
 const f=fixture(t,async()=>output([reply('마지막에 풀어서 속 시원했다 ㅋㅋ')])),sessionId=randomUUID();
 for(let i=0;i<4;i++)f.s.journal.record({id:randomUUID(),personaId:'streamer',name:'방장',text:i===3?'UNSEEN_PRIVATE_CONTEXT':`퍼즐 조각 ${i}`,time:T-1000+i,kind:'streamer'},{sessionId,witnesses:i===3?[]:['momo']});
 await f.visit();assert.equal(f.calls,1);assert.ok(!JSON.stringify(f.last).includes('UNSEEN_PRIVATE_CONTEXT'));assert.equal(f.last.history.length,3);assert.equal(f.s.audience.data.posts[0].category,'후기');assert.equal(f.s.audience.data.communityActivity.reviews.length,1);
 await f.visit(COMMUNITY_COOLDOWN+1);assert.equal(f.calls,1);
});
test('hourly call budget, startup delay and clock rollback survive an app restart',async t=>{
 const f=fixture(t);for(let i=0;i<10;i++)f.s.community.post({title:'기록 '+i,text:'합성 게시글 '+i});
 f.s.pump();assert.equal(f.calls,0);for(let i=0;i<8;i++)await f.visit(240001);assert.equal(f.calls,COMMUNITY_HOURLY_LIMIT);
 const next=fixture(t,async()=>output(),{audience:structuredClone(f.s.audience.data),now:f.now});await next.visit();assert.equal(next.calls,0);next.setNow(T-100000);await next.visit();assert.equal(next.calls,0);
 next.setNow(f.now+COMMUNITY_HOUR);await next.visit();assert.equal(next.calls,1);
});
test('live work, training, rehearsal, disabled activity and session cap prevent background calls',async t=>{
 for(const block of [s=>s.settings.communityActivityEnabled=false,s=>s.settings.mode='rehearsal',s=>s.busy=true,s=>s.audioBusy=true,s=>s.calls=s.settings.maxCalls,s=>s.queue.push({due:T+10000000}),s=>s.training.active={}]){
  const f=fixture(t);f.clip();block(f.s);if(f.s.training.active){f.s.communityActivity.tick();assert.equal(f.calls,0);f.s.training.active=null;}else{await f.visit();assert.equal(f.calls,0);}
 }
});
test('starting a stream cancels a background visit and ignores providers which return late',async t=>{
 let finish,signal;const f=fixture(t,(_a,s)=>{signal=s;return new Promise(r=>finish=r);});f.clip();const visit=f.visit();assert.equal(f.s.state().busy,false);assert.equal(f.s.busy,true);
 f.s.start();assert.equal(signal.aborted,true);finish(output([reply('취소된 응답')]));await visit;assert.equal(f.clips.data[0].comments.length,0);assert.equal(f.clips.data[0].activityReads,undefined);assert.equal(f.s.running,true);
});
test('new microphone input cancels an idle-stream visit without losing the utterance',async t=>{
 let finish,signal;const f=fixture(t,(_a,s)=>{signal=s;return new Promise(r=>finish=r);});f.s.start();f.clip();const visit=f.visit();
 f.s.receiveSpeech({id:randomUUID(),sessionId:f.s.sessionId,text:'지금 뭐 하고 있어요?',source:'microphone'});assert.equal(signal.aborted,true);finish(output([reply('늦은 답글')]));await visit;
 assert.equal(f.s.speechInbox.pending.length,1);assert.equal(f.clips.data[0].comments.length,0);assert.equal(f.s.messages.filter(m=>m.text==='지금 뭐 하고 있어요?').length,1);
});
test('removed viewers, unknown reply targets and inappropriate text cannot publish late comments',async t=>{
 for(const mutate of ['remove','target','spoiler','blocked']){
  let finish;const f=fixture(t,()=>new Promise(r=>finish=r)),c=f.clip();f.s.settings.blockedWords=['금지어'];const visit=f.visit();
  if(mutate==='remove')f.s.settings.personas=f.s.settings.personas.filter(p=>p.id!=='momo');
  finish(output([{...reply(mutate==='blocked'?'금지어':'내용',mutate==='target'?randomUUID():null),spoiler:mutate==='spoiler'}]));await visit;assert.equal(f.clips.get(c.id).comments.length,0);
 }
});
test('retired manual AI routes reject even authenticated requests without spending model calls',async t=>{
 let calls=0;const service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true}),react:async()=>{calls++;return output();}}});t.after(()=>service.close());
 const headers={Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'};
 for(const path of ['community/reflect',`community/posts/${randomUUID()}/react`,`clips/${randomUUID()}/react`]){const r=await fetch(service.url+'/api/'+path,{method:'POST',headers,body:'{}'});assert.equal(r.status,410);}
 assert.equal(calls,0);
});
test('automatic discussion cannot mint donations, create viewers or generate another clip from model extras',async t=>{
 const f=fixture(t,async()=>({...output(),observation:{...output().observation,arrival:{name:'unexpected'},clipPicks:[{personaId:'momo',title:'recursive'}],positiveMoment:{positive:true,impact:1,supporters:['momo']},viewerChanges:[{personaId:'momo',nickname:'forced'}]}}));
 f.clip();const economy=structuredClone(f.s.economy.data),personas=structuredClone(f.s.settings.personas);await f.visit();assert.deepEqual(f.s.economy.data,economy);assert.deepEqual(f.s.settings.personas,personas);assert.equal(f.clips.data.length,1);
});
test('a foreground reaction waits for cancellation to settle before acquiring the shared model slot',async t=>{
 let release,backgroundSignal,liveCalls=0;
 const f=fixture(t,(a,signal)=>{if(a.special?.automatic){backgroundSignal=signal;return new Promise(r=>release=r);}liveCalls++;return Promise.resolve({observation:{...output().observation,game:'Just Chatting',scene:'새 발언',confidence:1,excitement:0}});});
 f.s.start();f.clip();const visit=f.visit();const foreground=f.s.react({speech:'다음 방송에는 뭐 할까요?'});assert.equal(backgroundSignal.aborted,true);assert.equal(liveCalls,0);
 release(output([reply('이미 취소된 댓글')]));await visit;await foreground;assert.equal(liveCalls,1);assert.equal(f.clips.data[0].comments.length,0);assert.equal(f.s.busy,false);
});

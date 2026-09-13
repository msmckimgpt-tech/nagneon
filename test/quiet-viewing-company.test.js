import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {defaults} from '../shared/defaults.js';
const observation=(messages=[])=>({game:'Synthetic',scene:'a quiet menu',confidence:.9,excitement:.1,messages});
const chat=(id,text)=>({personaId:id,text,kind:'chat',spoiler:false});
function fixture(t,react=async()=>({observation:observation()})){
 let at=100000;const requests=[];
 const s=new Studio({settings:{...defaults,mode:'live',category:'just-chatting',lurkRatio:0,slowModeSeconds:0,intervalSeconds:5,autoHighlights:false},now:()=>at,random:()=>.5,audience:new Audience(undefined,()=>{},()=>.5),provider:{status:()=>({configured:true}),react:(a,signal)=>{requests.push(a);return react(a,signal);}}});
 clearInterval(s.timer);s.start();t.after(()=>s.close());
 return {s,requests,advance:n=>at+=n,lurk:()=>{for(const p of s.settings.personas)if(p.id!==s.settings.managerId)s.audience.setPresence(p.id,'lurking',at);}};
}
test('a quiet viewer can volunteer once without becoming active or receiving fake progress',async t=>{
 const f=fixture(t,async a=>({observation:observation(a.ambient?.id==='quiet-company'?[chat('momo','저는 작은 퍼즐이 좋아요'),chat('momo','그리고 탐험하는 것도요')]:[])}));
 await f.s.react({image:'same',speech:'오늘은 천천히 같이 놀아요'});f.lurk();
 const members=structuredClone(f.s.audience.data.members),balance=structuredClone(f.s.economy.data),before=structuredClone(f.s.observation);
 f.advance(65000);await f.s.react({image:'same'});
 const req=f.requests.at(-1),row=f.s.reactions.snapshot(f.s.queue).requests.at(-1);
 assert.equal(req.ambient.idle,true);assert.equal(req.settings.personas.filter(p=>p.id!==defaults.managerId).length,1);
 assert.equal(row.company,'idle');assert.equal(row.lurkingEligible,1);assert.equal(row.eligibleViewers,1);
 assert.equal(f.s.queue.length,1);assert.equal(f.s.queue[0].chatDriven,true);assert.equal(row.rejected.pace,1);
 assert.equal(f.s.audience.presence.momo,'lurking');
 for(const id of Object.keys(members))for(const key of ['joinedAt','sessions','affinity','recognized'])assert.equal(f.s.audience.data.members[id][key],members[id][key]);
 assert.deepEqual(f.s.economy.data,balance);assert.deepEqual(f.s.observation,before);
 f.advance(2000);f.s.pump();assert.equal(f.s.messages.at(-1).text,'저는 작은 퍼즐이 좋아요');
 f.advance(65000);assert.equal((await f.s.react({image:'same'})).skipped,'unchanged-input');assert.equal(f.requests.length,2);
});
test('the manager alone cannot consume the next viewer companionship opportunity',async t=>{
 const f=fixture(t);await f.s.react({image:'same',speech:'오늘은 작은 퍼즐을 풀고 있어요'});
 for(const p of f.s.settings.personas)if(p.id!==defaults.managerId)f.s.audience.setPresence(p.id,'away',f.s.now());
 f.advance(65000);await f.s.react({image:'same'});assert.equal(f.s.ambient.nextIdleAt,0);assert.equal(f.requests.at(-1).ambient,null);
 f.s.audience.setPresence('momo','lurking',f.s.now());f.advance(5000);await f.s.react({image:'same'});
 assert.equal(f.requests.at(-1).ambient.id,'quiet-company');assert.ok(f.requests.at(-1).settings.personas.some(p=>p.id==='momo'));
 assert.equal(f.requests.at(-1).viewerContext.momo.chatHistory.length,0,'late arrival cannot inherit earlier broadcast speech');
});
test('only one present, enabled, current-visit lurker can join active reaction candidates',t=>{
 const f=fixture(t);f.lurk();f.s.settings.personas.push({...f.s.settings.personas[0],id:'system-helper',system:true});f.s.audience.data.members['system-helper']={joinedAt:f.s.now()};f.s.audience.presence['system-helper']='lurking';
 f.s.settings.personas.find(p=>p.id==='gg').enabled=false;f.s.audience.setPresence('pop','away',f.s.now());f.s.audience.data.members.new.joinedAt=f.s.startedAt-1;
 const before=structuredClone(f.s.audience.data),presence=structuredClone(f.s.audience.presence);
 assert.deepEqual(f.s.audience.context(f.s.settings).eligible,[defaults.managerId]);
 assert.deepEqual(new Set(f.s.audience.context(f.s.settings,'',0,{company:true}).eligible),new Set(['momo',defaults.managerId]));
 assert.deepEqual(f.s.audience.context(f.s.settings,'',0,{company:true,hearers:[defaults.managerId]}).eligible,[defaults.managerId]);
 assert.deepEqual(f.s.audience.data,before);assert.deepEqual(f.s.audience.presence,presence);
});
test('quiet requests suppress volunteers; a named question retains its own speaking priority',async t=>{
 const f=fixture(t);await f.s.react({image:'same',speech:'잠깐 조용히 봐주세요'});f.lurk();f.advance(65000);
 await f.s.react({image:'changed'});assert.equal(f.requests.at(-1).ambient.quiet,true);assert.equal(f.requests.at(-1).settings.personas.length,1);
 f.advance(5000);await f.s.react({image:'changed',speech:'모모는 퍼즐이랑 탐험 중에 뭐가 더 좋아요?'});
 assert.notEqual(f.requests.at(-1).ambient?.id,'quiet-company');assert.ok(f.requests.at(-1).settings.personas.some(p=>p.id==='momo'));
 assert.equal(f.s.audience.presence.pop,'lurking');assert.equal(f.s.ambient.snapshot().quiet,true);
});
test('a volunteered lurker still receives current video and is dropped after leaving mid-response',async t=>{
 let resolve;const f=fixture(t,async a=>a.ambient?.id==='quiet-company'?new Promise(r=>resolve=r):{observation:observation()});
 const sourceId=randomUUID(),video=image=>({sessionId:f.s.sessionId,sourceId,frames:[{image,at:f.s.now()}]});
 await f.s.react({video:video('first'),speech:'오늘은 같이 느긋하게 봐요'});f.lurk();f.advance(65000);
 const pending=f.s.react({video:video('new-event')});
 const req=f.requests.at(-1);assert.equal(req.ambient.watching,true);assert.equal(req.image,'new-event');assert.equal(req.frames.length,1);assert.equal(req.screenTimeline.sourceId,sourceId);
 f.s.audience.setPresence('momo','away',f.s.now());resolve({observation:observation([chat('momo','이건 좀 탐나는데')])});await pending;
 assert.equal(f.s.queue.length,0);assert.equal(f.s.reactions.snapshot().summary.rejected.absent,1);
});

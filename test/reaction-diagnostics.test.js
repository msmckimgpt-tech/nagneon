import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {ReactionDiagnostics} from '../server/reaction-diagnostics.js';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {defaults} from '../shared/defaults.js';
import {startServer} from '../server/index.js';
const message=(text='UNIQUE-PRIVATE-CHAT',extra={})=>({personaId:'pop',text,kind:'chat',spoiler:false,...extra});
const result=(messages=[])=>({observation:{game:'PRIVATE-GAME',scene:'PRIVATE-SCENE',confidence:.8,excitement:.2,messages}});
function fixture(t,react){
 let at=100000;const s=new Studio({settings:{...defaults,mode:'live',intervalSeconds:5,lurkRatio:0,slowModeSeconds:0,chatPace:8,autoHighlights:false},random:()=>.5,audience:new Audience(undefined,()=>{},()=>.5),now:()=>at,provider:{status:()=>({configured:true}),react:args=>react(args)}});
 clearInterval(s.timer);s.start();t.after(()=>s.close());
 return {s,advance:n=>at+=n,now:()=>at,report:()=>s.reactions.snapshot(s.queue),video:()=>({sessionId:s.sessionId,sourceId:randomUUID(),frames:[{image:'data:image/png;base64,U0VDUkVU',at}]})};
}
test('diagnostics separate model silence, admission filters and actual delayed delivery without text',async t=>{
 let messages=[];const f=fixture(t,()=>result(messages));await f.s.react({speech:'PRIVATE-SPEECH'});
 messages=[message('normal'),message('normal'),message('스포 내용',{spoiler:true}),message('이 카드를 쓰세요',{advice:true})];f.advance(6000);await f.s.react({speech:'다음 화면 볼게요'});
 let r=f.report();assert.equal(r.summary.modelSilent,1);assert.equal(r.summary.generated,4);assert.equal(r.summary.pending,1);assert.equal(r.summary.delivered,0);assert.equal(r.summary.rejected.duplicate,1);assert.equal(r.summary.rejected.spoiler,1);assert.equal(r.summary.rejected.advice,1);
 f.advance(2000);f.s.pump();r=f.report();assert.equal(r.summary.delivered,1);assert.equal(r.summary.pending,0);assert.equal(r.requests[1].firstDeliveryMs,2000);assert.equal(f.s.messages.filter(m=>m.kind==='chat').length,1);
 const raw=JSON.stringify(r);for(const secret of ['PRIVATE','normal','pop','personaId','data:image','text'])assert.ok(!raw.includes(secret),secret);
 assert.equal('diagnosticId' in f.s.messages.at(-1),false);
});
test('slow model expiry differs from queued expiry and both preserve the existing freshness policy',async t=>{
 let f,slow=true;f=fixture(t,()=>{if(slow)f.advance(21000);return result([message()]);});f.advance(1000);
 assert.equal((await f.s.react({video:f.video()})).skipped,'stale-screen');let r=f.report();assert.equal(r.requests[0].modelMs,21000);assert.equal(r.requests[0].state,'stale-screen');assert.equal(r.summary.rejected.expired,1);assert.equal(f.s.queue.length,0);
 slow=false;f.advance(6000);await f.s.react({video:f.video()});f.s.settings.slowModeSeconds=60;f.s.lastSpeaker.set('pop',f.now());f.advance(21000);f.s.pump();r=f.report();assert.equal(r.summary.rejected.expired,2);assert.equal(r.summary.delivered,0);assert.equal(r.requests[1].state,'accepted');
});
test('presence loss during generation or delivery is accounted without exposing viewer identity',async t=>{
 let release;const f=fixture(t,()=>new Promise(r=>release=r));const pending=f.s.react({speech:'PRIVATE'});f.s.audience.setPresence('pop','away',f.now());release(result([message()]));await pending;
 assert.equal(f.report().summary.rejected.absent,1);assert.equal(f.s.queue.length,0);
 f.s.audience.setPresence('pop','active',f.now());f.advance(6000);const next=f.s.react({speech:'second'});release(result([message()]));await next;f.s.audience.setPresence('pop','away',f.now());f.advance(2000);f.s.pump();assert.equal(f.report().summary.rejected.absent,2);
});
test('new speech clears pending output and stop retains diagnostics until a new broadcast',async t=>{
 const f=fixture(t,()=>result([message()]));await f.s.react({speech:'first'});
 f.s.receiveSpeech({id:randomUUID(),sessionId:f.s.sessionId,text:'new speech'});let r=f.report();assert.equal(r.summary.rejected.cleared,1);assert.equal(r.summary.pending,0);
 f.s.stop();assert.equal(f.report().summary.attempts,1);f.s.start();assert.equal(f.report().summary.attempts,0);assert.equal(f.report().requests.length,0);
});
test('superseded and failed operations are not silent model responses; private errors are omitted',async t=>{
 let release;const f=fixture(t,()=>new Promise(r=>release=r));f.advance(1000);const video=f.video(),pending=f.s.react({video});f.s.endVideo(video);release(result([message()]));assert.equal((await pending).skipped,'superseded');assert.equal(f.report().requests[0].state,'superseded');
 f.advance(6000);f.s.provider.react=async()=>{f.advance(90000);throw Error('PRIVATE-TOKEN-AND-ERROR');};await assert.rejects(f.s.react({speech:'secret'}),/PRIVATE/);const r=f.report();assert.equal(r.requests[1].state,'error');assert.equal(r.summary.modelSilent,0);assert.equal(r.summary.modelP95Ms,0,'failed call is not a completed model response');assert.ok(!JSON.stringify(r).includes('PRIVATE'));
});
test('retention is bounded, snapshots are independent and old completions cannot mutate a new broadcast',()=>{
 let at=0;const d=new ReactionDiagnostics(()=>at);const old=d.begin({text:'PRIVATE',hasSpeech:true});d.reset();const current=d.begin();d.generated(old,8);d.finish(old,'accepted');assert.equal(d.row(current).generated,null);
 for(let i=0;i<125;i++){const id=d.begin();at+=10;d.generated(id,0);d.finish(id,'accepted');}d.skip('PRIVATE');d.skip('busy');let r=d.snapshot();assert.equal(r.limit,120);assert.equal(r.requests.length,120);assert.equal(r.summary.attempts,126);assert.equal(r.summary.modelP95Ms,10);assert.deepEqual(r.skips,{busy:1});r.requests[0].generated=99;assert.equal(d.snapshot().requests[0].generated,0);assert.ok(!JSON.stringify(r).includes('PRIVATE'));
});
test('first-chat wait measures delivered responses only, separating inference from delivery',()=>{
 let at=100000;const d=new ReactionDiagnostics(()=>at);
 assert.equal(d.snapshot().summary.firstChatWaitP50Ms,null);
 for(const [model,wait] of [[8000,0],[600,800],[10000,2500]]){
  const id=d.begin();at+=model;d.generated(id,1);d.admit(id);at+=wait;d.delivered(id);d.finish(id,'accepted');
 }
 const silent=d.begin();at+=15000;d.generated(silent,0);d.finish(silent,'accepted');
 const error=d.begin();at+=90000;d.finish(error,'error');
 const pending=d.begin();d.generated(pending,1);d.admit(pending);
 const summary=d.snapshot([{diagnosticId:pending}]).summary;
 assert.equal(summary.firstChatSamples,3);assert.equal(summary.firstChatWaitP50Ms,800);assert.equal(summary.firstChatWaitP95Ms,2500);
 d.reset();assert.equal(d.snapshot().summary.firstChatSamples,0);assert.equal(d.snapshot().summary.firstChatWaitP95Ms,null);
});
test('company diagnostics preserve only bounded categories and candidate counts',()=>{
 const d=new ReactionDiagnostics();d.begin({company:'idle',eligible:2,eligibleViewers:1,lurkingEligible:1});d.begin({company:'PRIVATE-TEXT',eligibleViewers:Infinity,lurkingEligible:-5});
 const rows=d.snapshot().requests;assert.equal(rows[0].company,'idle');assert.equal(rows[0].eligibleViewers,1);assert.equal(rows[0].lurkingEligible,1);
 assert.equal(rows[1].company,null);assert.equal(rows[1].eligibleViewers,0);assert.equal(rows[1].lurkingEligible,0);assert.ok(!JSON.stringify(rows).includes('PRIVATE'));
});
test('a previous broadcast finishing late cannot add a skip to the new broadcast diagnostics',async t=>{
 let release;const f=fixture(t,()=>new Promise(r=>release=r));const old=f.s.react({speech:'old private conversation'});
 f.s.stop();f.s.start();release(result());assert.equal((await old).skipped,'stopped');
 assert.equal(f.report().summary.attempts,0);assert.deepEqual(f.report().skips,{});assert.deepEqual(f.report().requests,[]);
});
test('diagnostic HTTP export is authenticated, uncached, content-free and does not call the model',async t=>{
 let calls=0;const app=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true}),react:async()=>{calls++;return result();}}});t.after(()=>app.close());
 const endpoint=app.url+'/api/diagnostics/reactions?download=true';assert.equal((await fetch(endpoint)).status,401);
 const id=app.studio.reactions.begin({hasSpeech:true});app.studio.reactions.generated(id,0);app.studio.reactions.finish(id,'accepted');
 app.studio.lastError='PRIVATE-ERROR';app.studio.messages.push({id:'PRIVATE-ID',text:'PRIVATE-CHAT'});
 const response=await fetch(endpoint,{headers:{Authorization:'Bearer '+app.accessToken}});assert.equal(response.status,200);assert.match(response.headers.get('content-disposition'),/attachment.*backseat-reaction-diagnostics.json/);assert.equal(response.headers.get('cache-control'),'no-store');const raw=await response.text();assert.ok(!raw.includes('PRIVATE'));assert.equal(JSON.parse(raw).summary.modelSilent,1);assert.equal(calls,0);
});

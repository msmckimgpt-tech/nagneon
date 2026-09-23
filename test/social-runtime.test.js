import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,readFileSync,writeFileSync,copyFileSync,existsSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {startServer} from '../server/index.js';
import {WorldData} from '../server/world.js';
import {digest,emptySocialRuntime,migrateSocial} from '../server/social-runtime-state.js';
import {emptySocialWorld} from '../server/social-world-state.js';
import {OpenAIProvider} from '../server/provider.js';
import {liveViewerContext} from '../server/viewer-context.js';
const birth={name:'모래기록',personality:'차분하게 탐험하는 주민',values:'스스로 발견하는 즐거움',expertise:.4,sociability:.6};
const result=(extra={})=>({observation:{game:'일상',scene:'',confidence:.7,excitement:.2,messages:[],...extra},usage:{total_tokens:3}});
const person=(id,name)=>({...birth,id,name,color:'#8bcdd2',role:'viewer',enabled:true,system:false});
async function fixture(t,{persist=false,dataDir,react}={}){let calls=[],now=Date.now()+100000;const service=await startServer({port:0,persist,dataDir,localSpeech:false,provider:{status:()=>({configured:true}),react:async(a,signal)=>{calls.push(a);return react?react(a,signal):result(a.special.kind==='social-birth'?{arrival:{...birth,name:'주민'+calls.length}}:a.special.kind==='social-read'?{communityVotes:[{personaId:a.settings.personas[0].id,recommended:true}]}:{messages:[{personaId:a.settings.personas[0].id,text:a.special.kind==='social-mention'?'방장님이 오늘 퍼즐 풀었다니 신기하네':'길 모퉁이를 살피다가 숨은 길을 찾았어',kind:'chat',spoiler:false}]});}}});
 const s=service.studio;clearInterval(s.timer);s.now=()=>now;s.settings.mode='live';s.ai.update({background:true});s.tutorialReady=()=>true;if(t)t.after(()=>service.close());
 const advance=ms=>now+=ms;
 const add=()=>{const author={id:randomUUID(),communityId:'guide',persona:person('witness','퍼즐산책'),joinedAt:now-10000,admitted:true},reader={id:randomUUID(),communityId:'guide',persona:person('reader','별먼지'),joinedAt:now-10000,admitted:false};s.world.change(w=>{w.settings.mode='live';w.settings.personas.push(author.persona);w.audience.members.witness={sessions:1,seconds:0,recognized:0,affinity:.2,peers:{},memories:[]};w.socialWorld.residents.push(author,reader);});return {author,reader};};
 const source=()=>{const id=randomUUID();s.journal.record({id,personaId:'streamer',name:'방장님',text:'오늘 퍼즐의 숨은 길을 찾았어',kind:'streamer',time:now-1000},{sessionId:randomUUID(),witnesses:['witness']});return s.social.source(s.journal.data.entries.find(e=>e.id===id),'witness');};
 const run=async target=>{const op={controller:new AbortController(),epoch:s.epoch,social:true};s.communityActivity.active=op;op.promise=s.communityActivity.run(target,op);try{await op.promise;}finally{s.communityActivity.active=null;s.busy=false;}};
 const target=(kind,resident,ref)=>({kind,id:resident.id,viewer:resident.persona,revision:digest(kind),raw:{residentId:resident.id,communityId:'guide',topicId:'practice',...(ref?{source:ref}:{})}});
 const mention=async author=>{const ref=source();await run(target('social-mention',author,ref));return s.social.data().threads.at(-1);};
 const read=async(reader,thread)=>run({...target('social-read',reader,thread.source),id:thread.id,raw:{...target('social-read',reader,thread.source).raw,threadId:thread.id,threadHash:digest(thread)}});
 return {...service,s,calls,advance,add,source,run,target,mention,read};
}
const req=(f,path,body,method=body===undefined?'GET':'POST')=>fetch(f.url+'/api/'+path,{method,headers:{Authorization:'Bearer '+f.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
test('community lifecycle: independent daily, witnessed mention, actual reading and one next-live persona/0P admission',async t=>{
 const f=await fixture(t),{s}=f,{author,reader}=f.add();
 await f.run(f.target('social-daily',author));assert.equal(s.ai.snapshot().recent[0].activityKind,'social-daily');assert.equal(s.ai.snapshot().recent[0].activityResult,'post-created');const daily=f.calls.at(-1);assert.equal(daily.settings.streamer,'방송인');assert.deepEqual(daily.history,[]);assert.equal(daily.special.delivered,null);
 const post=await f.mention(author);s.start();await f.read(reader,post);assert.equal(s.social.data().receipts.length,1);assert.equal(s.social.arrive(),false);const balance=s.economy.data.balance;
 s.stop();f.advance(1000);s.start();assert.equal(s.social.arrive(),true);assert.equal(s.economy.data.balance,balance);assert.equal(s.settings.personas.filter(p=>p.id===reader.persona.id).length,1);assert.deepEqual(s.settings.personas.find(p=>p.id===reader.persona.id),reader.persona);assert.equal(s.social.arrive(),false);assert.equal(s.social.data().receipts[0].eligibleFromLiveSequence,2);
 const context=liveViewerContext({members:[{id:'reader',joinedAt:f.s.now()}]},[reader.persona],[],null,{journal:s.journal,social:s.social,now:s.now()});assert.equal(context.viewerContext.reader.heardFromCommunity.length,1);assert.deepEqual(s.journal.recall('reader',''),[]);assert.deepEqual(context.viewerContext.reader.recollections,[]);
});
test('GET 100 times, detail and ego-search never mutate world or call provider; public DTO excludes private persona and evidence',async t=>{
 const f=await fixture(t),{author}=f.add();await f.mention(author);const before=JSON.stringify(f.s.world.data),calls=f.calls.length;
 for(let i=0;i<100;i++){const r=await req(f,'social/search?q='+encodeURIComponent('방장님'));assert.equal(r.status,200);const d=await r.json();assert.equal(d.total,1);assert.ok(!JSON.stringify(d).includes(author.persona.personality));assert.ok(!JSON.stringify(d).includes('witnessId'));}
 assert.equal(JSON.stringify(f.s.world.data),before);assert.equal(f.calls.length,calls);assert.equal((await fetch(f.url+'/api/social/search')).status,401);assert.equal((await req(f,'social/search?limit=51')).status,400);
});
test('new defaults ON and strict partial patch preserves saved OFF and other preferences',async t=>{
 const f=await fixture(t);assert.equal(f.s.social.enabled(),true);assert.equal(f.s.social.data().preferences.arrivalsEnabled,true);assert.equal((await req(f,'social/preferences',{enabled:false},'PATCH')).status,200);await req(f,'social/preferences',{arrivalsEnabled:false},'PATCH');assert.equal(f.s.social.enabled(),false);assert.equal((await req(f,'social/preferences',{unknown:true},'PATCH')).status,400);assert.equal(f.s.social.data().preferences.notifications,false);
});
test('birth uses the shared activity slot and attempts; all five community identities are reachable',async t=>{
 const f=await fixture(t),s=f.s;s.settings.communityActivityEnabled=false;f.advance(61000);s.communityActivity.tick();await s.communityActivity.active?.promise;assert.equal(f.calls.length,1);assert.equal(s.social.data().residents.length,1);assert.equal(s.communityActivity.data().attempts.length,1);assert.equal(s.ai.reason('community'),'');
 assert.equal(new Set(s.social.candidates(s.now()).map(c=>c.raw.communityId)).size,5);
 for(let i=0;i<7;i++){f.advance(300001);s.communityActivity.tick();await s.communityActivity.active?.promise;}assert.ok(f.calls.length<=6);
});
for(const action of ['off','mute','stop','forget','edit'])test('late '+action+' discards pending receipt and output',async t=>{
 let resolve;const f=await fixture(t,{react:async()=>new Promise(r=>resolve=r)}),{author}=f.add(),ref=f.source();const running=f.run(f.target('social-mention',author,ref));
 if(action==='off')f.s.social.preferences({enabled:false});if(action==='mute')f.s.social.preferences({mutedCommunities:['guide']});if(action==='stop')f.s.stop();if(action==='forget')f.s.journal.forget([ref.id]);if(action==='edit')f.s.journal.change(d=>{d.entries[0].text='수정된 내용';});
 resolve(result({messages:[{personaId:'witness',text:'늦은 글',kind:'chat',spoiler:false}]}));if(action==='edit')await running;else await assert.rejects(running,/abort/i);assert.equal(f.s.social.data().threads.length,0);assert.equal(f.s.social.data().receipts.length,0);assert.equal(f.s.communityActivity.data().attempts.length,1);
});
test('forget is durable before source delete; failed source deletion never revives derived text or knowledge',async t=>{
 const f=await fixture(t),{author,reader}=f.add(),post=await f.mention(author);await f.read(reader,post);assert.equal(f.s.social.memory('reader').length,1);
 f.s.journal.save=()=>{throw Error('source disk failure');};assert.throws(()=>f.s.journal.forget([post.source.id]),/source disk failure/);assert.equal(f.s.journal.data.entries.length,1);assert.equal(f.s.social.list().total,0);assert.equal(f.s.social.memory('reader').length,0);assert.equal(f.s.social.validReceipt(f.s.social.data().receipts[0]),false);
});
test('save failure does not publish a post or receipt; attempts persist independently',async t=>{
 const f=await fixture(t),{author}=f.add();let writes=0;f.s.world.save=()=>{if(++writes===2)throw Error('commit failed');};await assert.rejects(f.run(f.target('social-daily',author)),/commit failed/);assert.equal(f.s.social.data().threads.length,0);assert.equal(f.s.communityActivity.data().attempts.length,1);
 assert.equal(f.s.ai.snapshot().recent[0].application,'unconfirmed');assert.equal(f.s.ai.snapshot().recent[0].activityResult,undefined);
});
test('legacy reading migration never manufactures delivery proof',()=>{const old=emptySocialWorld(Date.now());const migrated=migrateSocial(old);assert.equal(migrated.version,2);assert.equal(migrated.receipts.length,0);assert.equal(migrated.residents.length,0);assert.deepEqual(migrated.legacy,old);});
test('private, unwitnessed, fictional and anomalous inputs are not public broadcast sources',async t=>{const f=await fixture(t);f.add();const source=f.source();assert.equal(f.s.social.validSource(source),true);for(const patch of [{fictional:true},{personaId:'someone'},{kind:'notice'},{witnesses:[]}]){const original=structuredClone(f.s.journal.data.entries[0]);Object.assign(f.s.journal.data.entries[0],patch);assert.equal(f.s.social.validSource(f.s.social.source(f.s.journal.data.entries[0],'witness')),false);f.s.journal.data.entries[0]=original;}});
test('profile writer excludes another server and releases on clean close; World2 never falls back to a pre-forget backup',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'social-persist-'));const f=await fixture(null,{persist:true,dataDir:dir});const {author}=f.add();const post=await f.mention(author);f.s.social.forget('thread',[post.id]);f.s.social.preferences({enabled:false});const raw=JSON.parse(readFileSync(join(dir,'world.json'),'utf8'));assert.equal(raw.version,2);assert.equal(raw.socialWorld.preferences.enabled,false);
 await assert.rejects(startServer({port:0,dataDir:dir,localSpeech:false,provider:{status:()=>({configured:false})}}),/프로필/);await f.close();assert.equal(existsSync(join(dir,'.nagneon-writer')),false);
 const again=await fixture(null,{persist:true,dataDir:dir});assert.equal(again.s.social.enabled(),false);await again.close();writeFileSync(join(dir,'world.json'),'{broken');await assert.rejects(startServer({port:0,dataDir:dir,localSpeech:false,provider:{status:()=>({configured:false})}}),/손상/);assert.equal(readFileSync(join(dir,'world.json'),'utf8'),'{broken');assert.equal(existsSync(join(dir,'.nagneon-writer')),false);
});
test('legacy/social truth table keeps one aggregate resource and does not toggle other settings',async t=>{for(const legacy of [false,true])for(const social of [false,true]){const f=await fixture(t);f.s.settings.communityActivityEnabled=legacy;f.s.social.preferences({enabled:social});f.advance(61000);assert.equal(f.s.communityActivity.available(),legacy||social);assert.equal(f.s.settings.communityActivityEnabled,legacy);}});
test('neutral provider payload cannot leak stream title, nickname, notes or real trend context into daily life',async t=>{const f=await fixture(t),{author}=f.add();f.s.settings.title='PRIVATE_STREAM_TITLE';f.s.settings.streamer='PRIVATE_NICKNAME';await f.run(f.target('social-daily',author));const payload=new OpenAIProvider({}).payload(f.calls[0]);const text=JSON.stringify(payload);assert.ok(!text.includes('PRIVATE_STREAM_TITLE'));assert.ok(!text.includes('PRIVATE_NICKNAME'));assert.deepEqual(f.calls[0].culture,{enabled:false});});
test('muting a community or topic withdraws prior interested receipt from admission',async t=>{const f=await fixture(t),{author,reader}=f.add(),post=await f.mention(author);await f.read(reader,post);f.s.start();for(const patch of [{mutedCommunities:['guide']},{mutedTopics:['practice']}]){f.s.social.preferences(patch);assert.equal(f.s.social.arrive(),false);f.s.social.preferences({mutedCommunities:[],mutedTopics:[]});}assert.equal(f.s.social.arrive(),true);});
test('actual tutorial accessor excludes new/active/paused until skipped',async t=>{const service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true})}});t.after(()=>service.close());clearInterval(service.studio.timer);assert.equal(service.studio.tutorialReady(),false);for(const action of ['begin','pause']){const response=await req(service,'tutorial',{action});assert.equal(response.status,200);assert.equal(service.studio.tutorialReady(),false);}assert.equal((await req(service,'tutorial',{action:'skip'})).status,200);assert.equal(service.studio.tutorialReady(),true);});
test('source backup recovery quarantines social GET, memory and automatic activity across restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'social-source-recovery-'));let f=await fixture(null,{persist:true,dataDir:dir});const {author,reader}=f.add();const post=await f.mention(author);await f.read(reader,post);f.source();await f.close();writeFileSync(join(dir,'conversation-journal-index.json'),'{bad');
 f=await fixture(null,{persist:true,dataDir:dir});assert.equal(f.s.social.data().quarantined,true);assert.equal(f.s.social.list().total,0);assert.deepEqual(f.s.social.memory('reader'),[]);assert.equal(f.s.social.enabled(),false);await f.close();f=await fixture(null,{persist:true,dataDir:dir});assert.equal(f.s.social.data().quarantined,true);await f.close();
});
test('migration backup failure preserves the only v1 primary; verified backup is exact',async()=>{
 const {backupWorldV1}=await import('../server/profile-writer.js');const dir=mkdtempSync(join(tmpdir(),'social-migration-'));const bytes=JSON.stringify({version:1,identity:'unchanged'});writeFileSync(join(dir,'world.json'),bytes);assert.throws(()=>backupWorldV1(dir,{copy:()=>{throw Error('copy failed');}}),/copy failed/);assert.equal(readFileSync(join(dir,'world.json'),'utf8'),bytes);assert.equal(existsSync(join(dir,'profile-format.json')),false);const saved=backupWorldV1(dir);assert.equal(readFileSync(saved.file,'utf8'),bytes);
});
test('social birth is permitted by the real provider schema instructions without becoming a live arrival',()=>{const provider=new OpenAIProvider({});const payload=provider.payload({settings:{...(awaitDefaults()),personas:[]},offStream:true,special:{kind:'social-birth'}});assert.match(payload.instructions,/social-birth/);assert.match(payload.instructions,/아직 방송에 방문하지 않은/);});
function awaitDefaults(){return {games:[{id:'community',name:'공동체'}],gameId:'community',personas:[],blockedWords:[],chatPace:1};}
test('failed server listen drains constructed timers before releasing the profile writer',async()=>{
 const {createServer}=await import('node:net');const occupied=createServer();await new Promise(r=>occupied.listen(0,'127.0.0.1',r));const handles=[],original=globalThis.setInterval;const dir=mkdtempSync(join(tmpdir(),'social-listen-failure-'));
 globalThis.setInterval=(...args)=>{const h=original(...args);handles.push(h);return h;};
 try{await assert.rejects(startServer({port:occupied.address().port,dataDir:dir,localSpeech:false,provider:{status:()=>({configured:true})}}),{code:'EADDRINUSE'});assert.ok(handles.some(h=>h._idleTimeout===-1));assert.ok(handles.every(h=>h._destroyed));assert.equal(existsSync(join(dir,'.nagneon-writer')),false);}finally{globalThis.setInterval=original;await new Promise(r=>occupied.close(r));}
});
test('next-live receipt survives restart and admits the same resident only once without point loss',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'social-next-live-'));let f=await fixture(null,{persist:true,dataDir:dir});const {author,reader}=f.add();f.s.start();const post=await f.mention(author);await f.read(reader,post);assert.equal(f.s.social.arrive(),false);const balance=f.s.economy.data.balance;await f.close();
 f=await fixture(null,{persist:true,dataDir:dir});f.s.start();assert.equal(f.s.social.data().liveSequence,2);assert.equal(f.s.social.arrive(),true);assert.equal(f.s.settings.personas.filter(p=>p.id===reader.persona.id).length,1);assert.equal(f.s.economy.data.balance,balance);await f.close();
 f=await fixture(null,{persist:true,dataDir:dir});f.s.start();assert.equal(f.s.social.arrive(),false);assert.equal(f.s.settings.personas.filter(p=>p.id===reader.persona.id).length,1);assert.equal(f.s.economy.data.balance,balance);await f.close();
});

test('resident preparation and a silent daily response never claim a published post in AI history',async t=>{
 const f=await fixture(t,{react:async a=>result(a.special.kind==='social-birth'?{arrival:birth}:{})});
 const target=f.s.social.candidates(f.s.now()).find(t=>t.kind==='social-birth');await f.run(target);
 assert.equal(f.s.ai.snapshot().recent[0].activityResult,'resident-created');assert.equal(f.s.social.list().total,0);
 const resident=f.s.social.data().residents[0];await f.run(f.target('social-daily',resident));
 assert.equal(f.s.ai.snapshot().recent[0].activityKind,'social-daily');assert.equal(f.s.ai.snapshot().recent[0].activityResult,'no-post');assert.equal(f.s.social.list().total,0);
});

test('independent resident posts without a roster or broadcast, rotates topics and stays outside the audience',async t=>{
 const f=await fixture(t),s=f.s;const target=s.social.candidates(s.now()).find(c=>c.kind==='social-birth'&&c.raw.communityId==='banter');await f.run(target);const resident=s.social.data().residents[0];assert.equal(s.settings.personas.some(p=>p.id===resident.persona.id),false);
 let daily=s.social.candidates(s.now()).find(c=>c.kind==='social-daily'&&c.id===resident.id);assert.ok(daily);await f.run(daily);let post=s.social.list({communityId:'banter'}).posts[0];assert.equal(post.kind,'daily');assert.equal(post.authorIsViewer,false);assert.equal(s.social.data().threads[0].source,null);assert.equal(s.journal.data.entries.length,0);assert.match(f.calls.at(-1).special.community.norms,/반말/);assert.match(f.calls.at(-1).special.instruction,/관객이 되지 않아도/);
 f.advance(2*3600000+1);daily=s.social.candidates(s.now()).find(c=>c.kind==='social-daily'&&c.id===resident.id);assert.notEqual(daily.raw.topicId,post.topicId);await f.run(daily);assert.equal(s.social.data().residents[0].admitted,false);assert.equal(s.settings.personas.some(p=>p.id===resident.persona.id),false);assert.equal(s.social.data().receipts.length,0);
 s.social.preferences({mutedTopics:['rants']});f.advance(2*3600000+1);assert.equal(s.social.candidates(s.now()).find(c=>c.kind==='social-daily'&&c.id===resident.id).raw.topicId,'hot-takes');
});
test('uninterested reader never becomes an audience member just from reading or later broadcasts',async t=>{
 const f=await fixture(t,{react:async a=>result(a.special.kind==='social-read'?{communityVotes:[{personaId:a.settings.personas[0].id,recommended:false}]}:{messages:[{personaId:a.settings.personas[0].id,text:'공동체의 이야기',kind:'chat',spoiler:false}]})}),{author,reader}=f.add();const post=await f.mention(author);await f.read(reader,post);assert.equal(f.s.social.data().receipts[0].interested,false);for(let i=0;i<3;i++){f.s.start();assert.equal(f.s.social.arrive(),false);f.s.stop();f.advance(300001);}assert.equal(f.s.settings.personas.some(p=>p.id===reader.persona.id),false);assert.equal(f.s.social.data().residents.find(r=>r.id===reader.id).admitted,false);
});
test('author badge follows current audience membership on list and detail, without rewriting posts',async t=>{
 const f=await fixture(t),{author,reader}=f.add();await f.run(f.target('social-daily',reader));const thread=f.s.social.data().threads[0],before=JSON.stringify(thread);assert.equal(f.s.social.detail(thread.id).authorIsViewer,false);const post=await f.mention(author);await f.read(reader,post);f.s.start();assert.equal(f.s.social.arrive(),true);assert.equal(f.s.social.detail(thread.id).authorIsViewer,true);assert.equal(f.s.social.list().posts.find(p=>p.id===thread.id).authorIsViewer,true);f.s.settings.personas=f.s.settings.personas.filter(p=>p.id!==reader.persona.id);assert.equal(f.s.social.detail(thread.id).authorIsViewer,false);assert.equal(JSON.stringify(f.s.social.data().threads.find(t=>t.id===thread.id)),before);
});
test('all five communities and ten topics can be muted together and preserve an old four-community preference',async t=>{
 const f=await fixture(t);const list=f.s.social.list().communities;assert.equal(list.length,5);assert.equal((await req(f,'social/preferences',{mutedCommunities:list.map(c=>c.id),mutedTopics:list.flatMap(c=>c.topics.map(t=>t.id))},'PATCH')).status,200);assert.deepEqual(f.s.social.candidates(f.s.now()),[]);assert.equal((await req(f,'social/preferences',{mutedCommunities:['guide','clips','indie','lounge'],mutedTopics:[]},'PATCH')).status,200);assert.ok(f.s.social.candidates(f.s.now()).every(c=>c.raw.communityId==='banter'));
});


test('shared community spacing, topic spread and recent public daily context prevent same-topic bursts',async t=>{
 const f=await fixture(t),{author,reader}=f.add();await f.run(f.target('social-daily',author));
 assert.ok(!f.s.social.candidates(f.s.now()).some(c=>c.kind==='social-daily'&&c.raw.communityId==='guide'));
 f.advance(20*60000+1);const candidate=f.s.social.candidates(f.s.now()).find(c=>c.kind==='social-daily'&&c.id===reader.id);assert.ok(candidate);assert.notEqual(candidate.raw.topicId,f.s.social.data().threads[0].topicId);
 await f.run(candidate);assert.equal(f.s.social.data().threads.length,1);assert.equal(f.s.ai.snapshot().recent[0].activityResult,'no-post');assert.equal(f.calls.at(-1).special.recentPosts.length,1);
});
test('comments, replies and idempotent recommendations retain existing broadcast receipt across restart',async()=>{
 const dir=mkdtempSync(join(tmpdir(),'social-discussion-'));let f=await fixture(null,{persist:true,dataDir:dir});const {author,reader}=f.add(),post=await f.mention(author);await f.read(reader,post);const receipt=f.s.social.data().receipts[0];
 let response=await req(f,'social/threads/'+post.id+'/comments',{text:'흥미로운 방법이네'});assert.equal(response.status,200);let dto=await response.json();const parent=dto.comments[0];
 response=await req(f,'social/threads/'+post.id+'/comments',{text:'다른 방법도 있을까',parentId:parent.id});assert.equal(response.status,200);
 await req(f,'social/threads/'+post.id+'/recommendation',{recommended:true},'PUT');await req(f,'social/threads/'+post.id+'/recommendation',{recommended:true},'PUT');
 assert.equal(f.s.social.detail(post.id).recommendationCount,1);assert.equal(f.s.social.validReceipt(receipt),true);
 await f.close();f=await fixture(null,{persist:true,dataDir:dir});try{dto=f.s.social.detail(post.id);assert.equal(dto.comments.length,2);assert.equal(dto.comments[1].parentId,parent.id);assert.equal(dto.recommendationCount,1);assert.equal(f.s.social.validReceipt(receipt),true);}finally{await f.close();}
});
test('resident replies to delivered comments and votes once; own response does not cause another visit',async t=>{
 const f=await fixture(t,{react:async a=>result({messages:[{personaId:a.settings.personas[0].id,text:a.special.kind==='social-discuss'?'그 길은 조작을 바꾸면 더 편하더라':'새로운 경로를 찾아봤어',kind:'chat',spoiler:false,replyTo:a.special.delivered?.comments?.[0]?.id||null}],communityVotes:[{personaId:a.settings.personas[0].id,recommended:true}]})}),{author,reader}=f.add();
 await f.run(f.target('social-daily',author));const post=f.s.social.data().threads[0];f.s.social.comment(post.id,{text:'키보드로 해도 되나요'});
 const target=f.s.social.candidates(f.s.now()).find(c=>c.kind==='social-discuss'&&c.viewer.id===reader.persona.id);assert.ok(target);await f.run(target);
 const dto=f.s.social.detail(post.id);assert.equal(dto.comments.length,2);assert.equal(dto.comments[1].parentId,dto.comments[0].id);assert.equal(dto.recommendationCount,1);assert.equal(dto.comments[1].authorIsViewer,false);assert.equal(f.s.social.data().receipts.length,0);
 f.advance(31*60000);assert.ok(!f.s.social.candidates(f.s.now()).some(c=>c.kind==='social-discuss'&&c.viewer.id===reader.persona.id));
});
test('forged parent, deleted parent and failed saves reject atomically',async t=>{
 const f=await fixture(t),{author}=f.add();await f.run(f.target('social-daily',author));const post=f.s.social.data().threads[0];
 assert.throws(()=>f.s.social.comment(post.id,{text:'답글',parentId:randomUUID()}),/답글/);assert.equal(f.s.social.detail(post.id).comments.length,0);
 const dto=f.s.social.comment(post.id,{text:'원문'});f.s.social.removeComment(post.id,dto.comments[0].id);assert.throws(()=>f.s.social.comment(post.id,{text:'답글',parentId:dto.comments[0].id}),/답글/);
 const before=JSON.stringify(f.s.world.data);f.s.world.save=()=>{throw Error('disk full');};assert.throws(()=>f.s.social.recommend(post.id,{recommended:true}),/disk full/);assert.equal(JSON.stringify(f.s.world.data),before);
});
test('late discussion result is rejected after original comment deletion',async t=>{
 let finish;const f=await fixture(t,{react:async a=>a.special.kind==='social-discuss'?new Promise(r=>finish=r):result({messages:[{personaId:a.settings.personas[0].id,text:'다양한 조작 설정을 비교했다',kind:'chat',spoiler:false}]})}),{author,reader}=f.add();await f.run(f.target('social-daily',author));const post=f.s.social.data().threads[0],dto=f.s.social.comment(post.id,{text:'나중에 지울 내용'});
 const target=f.s.social.candidates(f.s.now()).find(c=>c.kind==='social-discuss'&&c.viewer.id===reader.persona.id),running=f.run(target);f.s.social.removeComment(post.id,dto.comments[0].id);finish(result({messages:[{personaId:reader.persona.id,text:'늦은 답',kind:'chat',spoiler:false}]}));await assert.rejects(running,/abort/i);assert.equal(f.s.social.detail(post.id).comments.length,1);
});
test('real PNG upload is authenticated, bounded, persistent and inaccessible after forgetting',async t=>{
 const {pixelPng}=await import('../server/social-media.js');const png=pixelPng(JSON.stringify({palette:['#112233','#aabbcc'],pixels:Array(16).fill('0101010101010101')}));const dir=mkdtempSync(join(tmpdir(),'social-media-'));let f=await fixture(t,{persist:true,dataDir:dir});const {author}=f.add();await f.run(f.target('social-daily',author));const id=f.s.social.data().threads[0].id;
 const url=f.url+'/api/social/threads/'+id+'/attachments',headers={Authorization:'Bearer '+f.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/octet-stream','X-File-Name':encodeURIComponent('검증.png')};
 assert.equal((await fetch(url,{method:'POST',headers:{'Content-Type':'application/octet-stream','X-Backseat-Client':'studio'},body:png})).status,401);
 assert.equal((await fetch(url,{method:'POST',headers,body:Buffer.from('<svg onload=alert(1) />')})).status,409);
 const response=await fetch(url,{method:'POST',headers,body:png});assert.equal(response.status,200);const a=(await response.json()).attachments[0];let media=await req(f,a.url.slice(5));assert.equal(media.status,200);assert.deepEqual(Buffer.from(await media.arrayBuffer()),png);assert.equal(media.headers.get('cache-control'),'no-store');
 await f.close();f=await fixture(null,{persist:true,dataDir:dir});try{assert.equal(f.s.social.detail(id).attachments[0].available,true);f.s.social.forget('thread',[id]);media=await req(f,a.url.slice(5));assert.equal(media.status,409);}finally{await f.close();}
});
test('creative pixel PNG is default OFF; ON persists artwork and OFF strips generation instruction',async t=>{
 const {pixelPng}=await import('../server/social-media.js');const art=JSON.stringify({palette:['#000000','#ffffff'],pixels:Array(16).fill('0000111100001111')});
 const f=await fixture(t,{react:async a=>result({scene:art,messages:[{personaId:a.settings.personas[0].id,text:'새로 그린 성 지도를 소개함',kind:'chat',spoiler:false}]})}),{author}=f.add();assert.equal(f.s.social.data().preferences.creativeImages,false);await f.run(f.target('social-daily',author));assert.equal(f.s.social.detail(f.s.social.data().threads[0].id).attachments.length,0);assert.ok(!f.calls[0].special.instruction.includes('palette'));
 f.s.social.preferences({creativeImages:true});f.advance(86400001);await f.run(f.target('social-daily',author));const a=f.s.social.detail(f.s.social.data().threads.at(-1).id).attachments[0];assert.equal(a.generated,true);assert.deepEqual(f.s.social.media.read(a),pixelPng(art));assert.match(f.calls.at(-1).special.instruction,/palette/);
 assert.equal(pixelPng('{"script":"alert(1)"}'),null);assert.equal(pixelPng(JSON.stringify({palette:['#000000','#ffffff'],pixels:Array(16).fill('9999999999999999')})),null);
});

test('broadcast attachments reference only an existing witnessed clip; deleting original makes media unavailable',async t=>{
 const {pixelPng}=await import('../server/social-media.js');const dir=mkdtempSync(join(tmpdir(),'social-clip-ref-')),f=await fixture(t,{persist:true,dataDir:dir}),{author}=f.add(),source=f.source();
 const png=pixelPng(JSON.stringify({palette:['#000000','#ffffff'],pixels:Array(16).fill('0101010101010101')}));
 const c=f.s.clips.create({title:'같이 본 장면',game:'퍼즐',participants:[{id:author.persona.id,name:author.persona.name}],messages:[{id:source.id,personaId:'streamer',name:'방장님',text:'공개 발언',time:f.s.now(),kind:'streamer'}],scene:'검증 장면',sessionId:randomUUID(),image:'data:image/png;base64,'+png.toString('base64')});
 assert.equal(f.s.social.sharedClip(source,'unrelated'),null);await f.run(f.target('social-mention',author,source));const post=f.s.social.detail(f.s.social.data().threads[0].id);assert.equal(post.attachments[0].clipId,c.id);assert.equal(post.attachments[0].available,true);f.s.clips.remove(c.id);assert.equal(f.s.social.detail(post.id).attachments[0].available,false);
});

test('attachment limits and failed metadata save leave no published or orphan media',async t=>{
 const {pixelPng,SocialMedia}=await import('../server/social-media.js'),f=await fixture(t),{author}=f.add();await f.run(f.target('social-daily',author));const post=f.s.social.data().threads[0],png=pixelPng(JSON.stringify({palette:['#000000','#ffffff'],pixels:Array(16).fill('0101010101010101')}));
 const oversized=Buffer.alloc(8*1024*1024+1);png.copy(oversized);assert.throws(()=>f.s.social.attach(post.id,oversized,'large.png'),/8MB/);
 assert.throws(()=>f.s.social.media.save(Buffer.alloc(24*1024*1024+1),'large.webm'),/24MB/);
 const full=new SocialMedia();full.used=()=>200*1024*1024;assert.throws(()=>full.save(png,'quota.png'),/200MB/);
 f.s.world.save=()=>{throw Error('metadata failure');};assert.throws(()=>f.s.social.attach(post.id,png,'rollback.png'),/metadata failure/);assert.equal(f.s.social.media.memory.size,0);assert.equal(f.s.social.detail(post.id).attachments.length,0);
});

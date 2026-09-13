import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync,existsSync,readdirSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {Clips,ClipFeatures} from '../server/clips.js';
import {Studio} from '../server/studio.js';
import {defaults} from '../shared/defaults.js';

// Broadcast dates are local calendar dates. This oracle mirrors the product spec
// (year-month-day of a timestamp) so tests can assert which timestamp a clip's day follows.
const dayOf=ts=>{const d=new Date(ts);return [d.getFullYear(),String(d.getMonth()+1).padStart(2,'0'),String(d.getDate()).padStart(2,'0')].join('-');};
const T=Date.UTC(2026,4,10,12,0,0);            // a fixed noon so timezone shifts stay on the same day
const FIVE_DAYS=5*24*3600*1000;
const msg=(personaId,text,extra={})=>({personaId,text,kind:'chat',spoiler:false,...extra});
const okReact=messages=>async()=>({observation:{messages},usage:{total_tokens:5}});

// A minimal studio surface for ClipFeatures — lets each test control provider timing, epoch,
// audience state and training without booting timers or touching the filesystem/data.
function fakeStudio({personas=defaults.personas,members={},mode='live',blockedWords=[],spoilerGuard=true,react,startedAt=T,sessionId='session-1',messages=[msg('momo','안녕')],observation={game:'Test',scene:'보이는 장면'},training=null,maxCalls=100}={}){
  const spy={audienceMessage:[],audienceSave:0,publish:0,react:0,lastArgs:null};
  const studio={
    settings:{...defaults,mode,blockedWords,spoilerGuard,personas,streamer:'플레이어',maxCalls},
    busy:false,epoch:0,tokens:0,calls:0,controller:new AbortController(),
    sessionId,startedAt,observation,messages,training,
    audience:{data:{members},
      message(id,text){spy.audienceMessage.push({id,text});const m=members[id];if(m){m.memories=m.memories||[];m.memories.push(text);}},
      save(){spy.audienceSave++;}},
    provider:{react:async(...args)=>{spy.react++;spy.lastArgs=args[0];return (react||okReact([]))(...args);}},
    reserveCall(){if(this.calls>=this.settings.maxCalls)throw new Error('세션 API 호출 한도에 도달했습니다.');this.calls++;},
    publish(){spy.publish++;}
  };
  studio._spy=spy;
  return studio;
}
// A deferred provider so a test can hold the model call open and mutate state mid-flight.
function deferredReact(){let resolve;const promise=new Promise(r=>resolve=r);return {react:()=>promise,resolve};}

const baseClip=extra=>({title:'테스트 클립',game:'Test',participants:[{id:'momo',name:'모모'}],messages:[msg('momo','안녕')],scene:'보이는 장면',sessionId:'session-1',...extra});

// ---------------------------------------------------------------------------
// Clips.create — broadcast date follows the supplied session startedAt
// ---------------------------------------------------------------------------
test('broadcast date follows supplied session startedAt, not the save time', ()=>{
  // Saved five days after the broadcast started (e.g. after midnight / next day).
  const clips=new Clips({now:()=>T+FIVE_DAYS});
  const clip=clips.create(baseClip({startedAt:T}));
  assert.equal(clip.day, dayOf(T), '방송이 시작된 날짜여야 한다');
  assert.notEqual(clip.day, dayOf(T+FIVE_DAYS), '저장 시각의 날짜가 아니어야 한다');
  assert.equal(clip.startedAt, T);
});
test('automatic create without startedAt falls back to creation time', ()=>{
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip({source:'automatic-moment',observedAt:T}));
  assert.equal(clip.day, dayOf(T));
  assert.equal(clip.startedAt, null);
});
test('a non-finite startedAt is ignored and does not corrupt the day', ()=>{
  const clips=new Clips({now:()=>T});
  for(const bad of [undefined, null, NaN, 'nope']){
    const clip=clips.create(baseClip({startedAt:bad}));
    assert.equal(clip.day, dayOf(T));
    assert.equal(clip.startedAt, null);
  }
});

// ---------------------------------------------------------------------------
// Clips.commentBatch — atomic transaction, caps, depth, deleted parent
// ---------------------------------------------------------------------------
test('commentBatch commits every comment or none', ()=>{
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip());
  const created=clips.commentBatch(clip.id,[{text:'a',name:'모모',personaId:'momo'},{text:'b',name:'각',personaId:'gg'}]);
  assert.equal(created.length,2);
  assert.equal(clips.get(clip.id).comments.length,2);
  assert.equal(clips.get(clip.id).comments[0].kind,'ai');
});
test('failed persistence leaves no partial comment batch', ()=>{
  let failSave=false;
  const clips=new Clips({now:()=>T,save:()=>{if(failSave)throw new Error('디스크 쓰기 실패');}});
  const clip=clips.create(baseClip());
  failSave=true;
  assert.throws(()=>clips.commentBatch(clip.id,[{text:'a',name:'모모',personaId:'momo'},{text:'b',name:'각',personaId:'gg'},{text:'c',name:'팝',personaId:'pop'}]),/디스크 쓰기 실패/);
  assert.equal(clips.get(clip.id).comments.length,0,'저장 실패 시 하나도 남지 않아야 한다');
});
test('commentBatch rejects the whole batch when the per-clip cap would overflow', ()=>{
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip());
  clips.commentBatch(clip.id,Array.from({length:149},(_,i)=>({text:'c'+i,name:'모모',personaId:'momo'})));
  assert.throws(()=>clips.commentBatch(clip.id,[{text:'x',name:'모모',personaId:'momo'},{text:'y',name:'각',personaId:'gg'}]),/150개/);
  assert.equal(clips.get(clip.id).comments.length,149,'상한 초과 묶음은 일부도 저장되지 않는다');
  assert.equal(clips.commentBatch(clip.id,[{text:'z',name:'모모',personaId:'momo'}]).length,1);
  assert.equal(clips.get(clip.id).comments.length,150);
});
test('reply depth is capped at four levels', ()=>{
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip());
  let parentId=null;const ids=[];
  for(let level=0;level<4;level++){const [c]=clips.commentBatch(clip.id,[{text:'lvl'+level,name:'모모',personaId:'momo',parentId}]);ids.push(c.id);parentId=c.id;}
  assert.equal(clips.get(clip.id).comments.length,4);
  assert.throws(()=>clips.commentBatch(clip.id,[{text:'toodeep',name:'모모',personaId:'momo',parentId}]),/4단계/);
  assert.equal(clips.get(clip.id).comments.length,4);
});
test('replying to a deleted parent is rejected', ()=>{
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip());
  const [parent]=clips.commentBatch(clip.id,[{text:'부모',name:'모모',personaId:'momo'}]);
  clips.removeComment(clip.id,parent.id);
  assert.throws(()=>clips.commentBatch(clip.id,[{text:'답글',name:'각',personaId:'gg',parentId:parent.id}]),/대댓글 대상이 이 클립에 없습니다/);
  assert.equal(clips.get(clip.id).comments.length,1,'거부된 대댓글은 저장되지 않는다');
});
test('commentBatch on a missing clip throws and persists nothing', ()=>{
  const clips=new Clips({now:()=>T});
  assert.throws(()=>clips.commentBatch(randomUUID(),[{text:'a',name:'모모',personaId:'momo'}]),/핫클립을 찾을 수 없습니다/);
});
test('empty or over-long comment text is rejected atomically', ()=>{
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip());
  assert.throws(()=>clips.commentBatch(clip.id,[{text:'ok',name:'모모',personaId:'momo'},{text:'   ',name:'각',personaId:'gg'}]),/1~1,000자/);
  assert.throws(()=>clips.commentBatch(clip.id,[{text:'x'.repeat(1001),name:'모모',personaId:'momo'}]),/1~1,000자/);
  assert.equal(clips.get(clip.id).comments.length,0);
});
test('single comment() still returns one item and rejects a deleted parent', ()=>{
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip());
  const item=clips.comment(clip.id,{text:'스트리머',name:'플레이어'});
  assert.equal(item.kind,'streamer');
  assert.equal(clips.get(clip.id).comments.length,1);
  clips.removeComment(clip.id,item.id);
  assert.throws(()=>clips.comment(clip.id,{text:'답글',name:'플레이어',parentId:item.id}),/대댓글 대상이 이 클립에 없습니다/);
});

// ---------------------------------------------------------------------------
// Clips media paths, rollback, list, dedup, caps
// ---------------------------------------------------------------------------
test('file() rejects bad ids, extensions, traversal and a missing dir', ()=>{
  const dir=mkdtempSync(join(tmpdir(),'clips-file-'));
  try{
    const clips=new Clips({dir});
    const id=randomUUID();
    assert.equal(clips.file(id,'jpg'),join(dir,`${id}.jpg`));
    assert.ok(['png','webm'].every(ext=>clips.file(id,ext).endsWith('.'+ext)));
    assert.throws(()=>clips.file('NOT-A-UUID','jpg'),/미디어 파일 경로/);
    assert.throws(()=>clips.file(id,'gif'),/미디어 파일 경로/);
    assert.throws(()=>clips.file('../../etc/passwd','jpg'),/미디어 파일 경로/);
    assert.throws(()=>new Clips({}).file(id,'jpg'),/미디어 파일 경로/);
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('create rolls back a written thumbnail when persistence fails', ()=>{
  const dir=mkdtempSync(join(tmpdir(),'clips-roll-'));
  try{
    let failSave=false;
    const clips=new Clips({dir,now:()=>T,save:()=>{if(failSave)throw new Error('저장 실패');}});
    failSave=true;
    const image='data:image/png;base64,'+Buffer.from('thumb-bytes').toString('base64');
    assert.throws(()=>clips.create(baseClip({image})),/저장 실패/);
    assert.equal(readdirSync(dir).length,0,'실패한 클립의 썸네일은 정리되어야 한다');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('video attaches once, validates the buffer, and rolls back on save failure', ()=>{
  const dir=mkdtempSync(join(tmpdir(),'clips-video-'));
  try{
    let now=T,failSave=false;
    const clips=new Clips({dir,now:()=>now,save:()=>{if(failSave)throw new Error('저장 실패');}});
    const clip=clips.create(baseClip());
    const webm=Buffer.concat([Buffer.from('1a45dfa3','hex'),Buffer.alloc(200)]);
    const meta={startedAt:now-2000,endedAt:now,hasAudio:true};
    const updated=clips.video(clip.id,webm,meta);
    assert.equal(updated.video,true);
    assert.ok(existsSync(clips.file(clip.id,'webm')));
    assert.throws(()=>clips.video(clip.id,webm,meta),/이미 영상이 연결된/);
    // a fresh clip rejects a buffer without the WebM/EBML magic
    const bad=clips.create(baseClip());
    assert.throws(()=>clips.video(bad.id,Buffer.alloc(200),meta),/WebM/);
    // rollback: a second clip whose persistence fails must not leave a webm file behind.
    const other=clips.create(baseClip());
    failSave=true;
    assert.throws(()=>clips.video(other.id,webm,meta),/저장 실패/);
    assert.ok(!existsSync(clips.file(other.id,'webm')),'저장 실패한 영상 파일은 정리되어야 한다');
  }finally{rmSync(dir,{recursive:true,force:true});}
});
test('duplicate signature within the hour returns the same clip; 100-clip cap holds', ()=>{
  let now=T;const clips=new Clips({now:()=>now});
  const a=clips.create(baseClip({signature:'sig-1'}));
  const b=clips.create(baseClip({signature:'sig-1'}));
  assert.equal(a.id,b.id,'1시간 내 같은 서명은 중복 저장하지 않는다');
  now+=3600001;
  const c=clips.create(baseClip({signature:'sig-1'}));
  assert.notEqual(a.id,c.id,'1시간이 지나면 새 클립이 생긴다');
  while(clips.data.length<100)clips.create(baseClip());
  assert.throws(()=>clips.create(baseClip()),/100개/);
});
test('list hides comments/messages, exposes counts, and is newest-first', ()=>{
  const clips=new Clips({now:()=>T});
  const first=clips.create(baseClip({title:'첫'}));
  const second=clips.create(baseClip({title:'둘'}));
  clips.comment(first.id,{text:'댓글',name:'플레이어'});
  const list=clips.list();
  assert.equal(list[0].title,'둘','최신이 먼저');
  assert.equal(list[1].commentCount,1);
  assert.equal(list[1].comments,undefined);
  assert.equal(list[1].messages,undefined);
  assert.ok(list[1].messageCount>=1);
});

// ---------------------------------------------------------------------------
// ClipFeatures.save — session date + participant metadata
// ---------------------------------------------------------------------------
test('manual save records the session broadcast date and only real attendees', ()=>{
  const members={momo:{joinedAt:T,sessions:1},pop:{joinedAt:T-FIVE_DAYS,sessions:1}}; // pop attended an earlier session only
  const clips=new Clips({now:()=>T+FIVE_DAYS});
  const studio=fakeStudio({members,startedAt:T});
  const cf=new ClipFeatures(studio,clips);
  const clip=cf.save({title:'저장'});
  assert.equal(clip.day, dayOf(T), '방송 시작 날짜로 기록');
  const ids=clip.participants.map(p=>p.id);
  assert.ok(ids.includes('momo'));
  assert.ok(!ids.includes('pop'),'이전 세션에만 온 관객은 이 방송 참여자가 아니다');
  assert.equal(studio._spy.publish,1);
});
test('save refuses without a session or without any scene/dialogue', ()=>{
  const clips=new Clips({now:()=>T});
  assert.throws(()=>new ClipFeatures(fakeStudio({sessionId:null}),clips).save({}),/방송에서 함께한/);
  assert.throws(()=>new ClipFeatures(fakeStudio({messages:[],observation:null}),clips).save({}),/방송에서 함께한/);
});

// ---------------------------------------------------------------------------
// ClipFeatures.comments — target validation
// ---------------------------------------------------------------------------
test('comment targets must be unique, known, and enabled', async ()=>{
  const personas=[...defaults.personas.map(p=>({...p})),{id:'off',name:'비활성',color:'#000000',role:'viewer',personality:'x',enabled:false}];
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip());
  const studio=fakeStudio({personas});
  const cf=new ClipFeatures(studio,clips);
  await assert.rejects(cf.comments({id:clip.id,targets:['momo','momo']}),/중복/);
  await assert.rejects(cf.comments({id:clip.id,targets:['ghost']}),/활성 관객 중에서/);
  await assert.rejects(cf.comments({id:clip.id,targets:['off']}),/활성 관객 중에서/);
  await assert.rejects(cf.comments({id:clip.id,targets:[]}),/1~4명/);
  await assert.rejects(cf.comments({id:clip.id,targets:['momo','gg','pop','new','luna']}),/1~4명/);
  assert.equal(studio._spy.react,0,'검증 실패 시 모델을 호출하지 않는다');
  assert.equal(studio.calls,0,'검증 실패 시 호출 한도를 소비하지 않는다');
});

// ---------------------------------------------------------------------------
// ClipFeatures.comments — offstream metadata without pretending attendance
// ---------------------------------------------------------------------------
test('comment request marks non-attendees offstream and never claims video analysis', async ()=>{
  const members={momo:{joinedAt:T,sessions:2,affinity:0.3,memories:['이전 대화']},pop:{sessions:0}};
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip({participants:[{id:'momo',name:'모모'}]})); // only momo attended
  const studio=fakeStudio({members,react:okReact([msg('momo','좋았어요'),msg('pop','기록만 봤지만 재밌네요')])});
  const cf=new ClipFeatures(studio,clips);
  const res=await cf.comments({id:clip.id,targets:['momo','pop']});
  assert.equal(res.count,2);
  const args=studio._spy.lastArgs;
  assert.equal(args.offStream,true,'댓글은 오프스트림 감상 맥락으로 요청한다');
  assert.equal(args.settings.webSearch,false);
  assert.equal(args.settings.chatPace,2);
  const byId=Object.fromEntries(args.audience.members.map(m=>[m.id,m]));
  assert.equal(byId.momo.attended,true);
  assert.equal(byId.pop.attended,false,'참여하지 않은 관객은 attended=false');
  assert.match(args.special.instruction,/영상 자체를 재생·분석하지 않는다/);
  assert.match(args.special.instruction,/지어내지 않는다/);
  assert.equal(args.special.kind,'clip-comment');
  assert.equal(clips.get(clip.id).comments.length,2);
});

// ---------------------------------------------------------------------------
// ClipFeatures.comments — training gate
// ---------------------------------------------------------------------------
test('no model comment calls run while a training run is active', async ()=>{
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip());
  const studio=fakeStudio({training:{active:true}});
  const cf=new ClipFeatures(studio,clips);
  await assert.rejects(cf.comments({id:clip.id,targets:['momo']}),/연습/);
  assert.equal(studio._spy.react,0);
  assert.equal(studio.calls,0);
});

// ---------------------------------------------------------------------------
// ClipFeatures.comments — rejected comments filtered, no partial batch
// ---------------------------------------------------------------------------
test('spoilers, blocked words, duplicates and unknown speakers are dropped without partial writes', async ()=>{
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip());
  const studio=fakeStudio({blockedWords:['금지어'],react:okReact([
    msg('momo','좋아요'),
    msg('pop','미래 결말은',{spoiler:true}),        // spoiler + spoilerGuard
    msg('gg','금지어 포함'),                         // blocked word
    msg('momo','모모 중복'),                         // duplicate speaker
    msg('ghost','존재하지 않는 관객')                 // not a target
  ])});
  const cf=new ClipFeatures(studio,clips);
  const res=await cf.comments({id:clip.id,targets:['momo','pop','gg']});
  assert.equal(res.count,1,'유효한 momo 하나만 남는다');
  assert.equal(clips.get(clip.id).comments.length,1);
  assert.equal(clips.get(clip.id).comments[0].personaId,'momo');
  assert.equal(studio._spy.audienceMessage.length,1);
  assert.equal(studio._spy.audienceSave,1);
});
test('when nothing is displayable it throws and saves neither comments nor audience state', async ()=>{
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip());
  const studio=fakeStudio({react:okReact([msg('momo','스포',{spoiler:true})])});
  const cf=new ClipFeatures(studio,clips);
  await assert.rejects(cf.comments({id:clip.id,targets:['momo']}),/표시할 수 있는 댓글/);
  assert.equal(clips.get(clip.id).comments.length,0);
  assert.equal(studio._spy.audienceMessage.length,0);
  assert.equal(studio._spy.audienceSave,0,'실패 시 관객 저장도 하지 않는다');
});
test('a persistence failure during comment generation writes no comments and no audience changes', async ()=>{
  let failSave=false;
  const clips=new Clips({now:()=>T,save:()=>{if(failSave)throw new Error('디스크 쓰기 실패');}});
  const clip=clips.create(baseClip());
  failSave=true;
  const studio=fakeStudio({react:okReact([msg('momo','a'),msg('gg','b')])});
  const cf=new ClipFeatures(studio,clips);
  await assert.rejects(cf.comments({id:clip.id,targets:['momo','gg']}),/디스크 쓰기 실패/);
  failSave=false;
  assert.equal(clips.get(clip.id).comments.length,0,'부분 저장이 없어야 한다');
  assert.equal(studio._spy.audienceMessage.length,0,'저장 성공 후에만 관객 기억을 갱신한다');
  assert.equal(studio._spy.audienceSave,0);
});

// ---------------------------------------------------------------------------
// ClipFeatures.comments — cancellation & concurrent deletion during the model wait
// ---------------------------------------------------------------------------
test('a session change during the model wait cancels the batch', async ()=>{
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip());
  const d=deferredReact();
  const studio=fakeStudio({react:d.react});
  const cf=new ClipFeatures(studio,clips);
  const pending=cf.comments({id:clip.id,targets:['momo']});
  studio.epoch++;                                             // stop()/restart bumps the epoch
  d.resolve({observation:{messages:[msg('momo','늦은 댓글')]},usage:{total_tokens:9}});
  await assert.rejects(pending,/방송 상태가 바뀌어/);
  assert.equal(clips.get(clip.id).comments.length,0,'취소된 응답은 저장되지 않는다');
  assert.equal(studio.tokens,0,'취소 시 토큰을 집계하지 않는다');
  assert.equal(studio._spy.audienceSave,0);
});
test('a clip deleted during the model wait rejects the batch cleanly', async ()=>{
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip());
  const d=deferredReact();
  const studio=fakeStudio({react:d.react});
  const cf=new ClipFeatures(studio,clips);
  const pending=cf.comments({id:clip.id,targets:['momo']});
  clips.remove(clip.id);                                      // deleted mid-wait
  d.resolve({observation:{messages:[msg('momo','댓글')]},usage:{total_tokens:5}});
  await assert.rejects(pending,/핫클립을 찾을 수 없습니다/);
  assert.equal(studio._spy.audienceSave,0);
  assert.equal(studio.busy,false);
});
test('a parent deleted during the model wait rejects the reply batch', async ()=>{
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip());
  const [parent]=clips.commentBatch(clip.id,[{text:'부모',name:'모모',personaId:'momo'}]);
  const d=deferredReact();
  const studio=fakeStudio({react:d.react});
  const cf=new ClipFeatures(studio,clips);
  const pending=cf.comments({id:clip.id,parentId:parent.id,targets:['gg']});
  clips.removeComment(clip.id,parent.id);                     // parent deleted mid-wait
  d.resolve({observation:{messages:[msg('gg','답글')]},usage:{total_tokens:5}});
  await assert.rejects(pending,/대댓글 대상이 이 클립에 없습니다/);
  assert.equal(clips.get(clip.id).comments.length,1,'부모만 남고 답글은 저장되지 않는다');
});
test('replying to an already-deleted parent is refused before any model call', async ()=>{
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip());
  const [parent]=clips.commentBatch(clip.id,[{text:'부모',name:'모모',personaId:'momo'}]);
  clips.removeComment(clip.id,parent.id);
  const studio=fakeStudio();
  const cf=new ClipFeatures(studio,clips);
  await assert.rejects(cf.comments({id:clip.id,parentId:parent.id,targets:['gg']}),/대댓글 대상을 확인하세요/);
  assert.equal(studio._spy.react,0,'유효하지 않은 대댓글은 모델을 부르지 않는다');
});
test('a successful reply raises the commenter-to-parent familiarity but not toward the streamer', async ()=>{
  const members={gg:{joinedAt:T,sessions:1,peers:{}},pop:{joinedAt:T,sessions:1,peers:{}}};
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip());
  const [parent]=clips.commentBatch(clip.id,[{text:'모모의 말',name:'모모',personaId:'momo'}]);
  const studio=fakeStudio({members,react:okReact([msg('gg','모모 말에 답'),msg('pop','나도')])});
  const cf=new ClipFeatures(studio,clips);
  await cf.comments({id:clip.id,parentId:parent.id,targets:['gg','pop']});
  assert.equal(members.gg.peers.momo,1,'대댓글은 부모 관객과의 친밀도를 올린다');
  // streamer parent: no persona peer bump
  const [sParent]=clips.commentBatch(clip.id,[{text:'스트리머 말',name:'플레이어',personaId:'streamer',kind:'streamer'}]);
  const studio2=fakeStudio({members:{gg:{joinedAt:T,peers:{}}},react:okReact([msg('gg','스트리머께 답')])});
  await new ClipFeatures(studio2,clips).comments({id:clip.id,parentId:sParent.id,targets:['gg']});
  assert.deepEqual(studio2.audience.data.members.gg.peers,{},'스트리머에게는 관객 친밀도를 만들지 않는다');
});
test('comments refuse outside live mode and while the studio is busy', async ()=>{
  const clips=new Clips({now:()=>T});
  const clip=clips.create(baseClip());
  await assert.rejects(new ClipFeatures(fakeStudio({mode:'rehearsal'}),clips).comments({id:clip.id,targets:['momo']}),/실제 AI 관객 모드/);
  const busy=fakeStudio();busy.busy=true;
  await assert.rejects(new ClipFeatures(busy,clips).comments({id:clip.id,targets:['momo']}),/관객 응답을 기다린/);
  assert.equal(busy._spy.react,0);
});

// ---------------------------------------------------------------------------
// Integration — real Studio wiring, API compatibility
// ---------------------------------------------------------------------------
test('integration: real studio saves a dated clip and generates offstream AI comments', async t=>{
  let now=T, captured=null;
  const provider={status:()=>({configured:true}),
    react:async args=>{captured=args;return {observation:{messages:[{personaId:'momo',text:'좋았던 장면',kind:'chat',spoiler:false}]},usage:{total_tokens:7}};}};
  const studio=new Studio({provider,now:()=>now,random:()=>0,settings:{...defaults,mode:'live',lurkRatio:0}});
  t.after(()=>studio.close());
  studio.start();
  studio.addMessage('momo','안녕하세요','chat');
  const clip=studio.clipFeatures.save({title:'하이라이트'});
  assert.equal(clip.day, dayOf(studio.startedAt));
  assert.ok(clip.participants.some(p=>p.id==='momo'));
  const res=await studio.clipFeatures.comments({id:clip.id,targets:['momo']});
  assert.equal(res.count,1);
  assert.equal(captured.offStream,true);
  const stored=studio.clips.get(clip.id);
  assert.equal(stored.comments.length,1);
  assert.equal(stored.comments[0].kind,'ai');
  assert.equal(studio.busy,false);
  assert.ok(studio.tokens>=7);
});

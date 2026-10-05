import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdirSync,mkdtempSync,readFileSync,writeFileSync} from 'node:fs';
import {join,resolve} from 'node:path';
import {Studio} from '../server/studio.js';
import {Audience} from '../server/audience.js';
import {Clips} from '../server/clips.js';
import {JsonStore} from '../server/storage.js';
import {AudienceData,ClipsData} from '../server/data-schema.js';
import {COMMUNITY_COOLDOWN} from '../server/community-activity.js';
import {defaults} from '../shared/defaults.js';

const T=Date.UTC(2026,9,1);
const member=()=>({sessions:1,seconds:60,recognized:0,affinity:.3,peers:{},memories:[]});
function fixture(t,{ids=['momo'],silent=false,dir,initialNow=T}={}){
  let now=initialNow;
  const inputs=[];
  const initialAudience=()=>({members:Object.fromEntries(ids.map(id=>[id,member()])),posts:[],lore:[]});
  const world=dir?new JsonStore(join(dir,'audience.json'),{validate:value=>AudienceData.parse(value),initial:initialAudience}):null;
  const media=dir?new JsonStore(join(dir,'clips.json'),{validate:value=>ClipsData.parse(value),initial:()=>[]}):null;
  const audience=new Audience(world?world.load():initialAudience(),value=>world?world.save(value):AudienceData.parse(value));
  const clips=new Clips({data:media?media.load():[],now:()=>now,save:value=>media?media.save(value):ClipsData.parse(value)});
  const s=new Studio({
    audience,clips,now:()=>now,random:()=>0,
    settings:{...defaults,mode:'live',communityActivityEnabled:true,personas:defaults.personas.map(p=>({...p,enabled:ids.includes(p.id)||p.id===defaults.managerId}))},
    provider:{status:()=>({configured:true}),react:async input=>{
      inputs.push(input);
      const id=input.settings.personas[0].id;
      return {observation:{messages:silent?[]:[{personaId:id,text:`합성 감상 ${id} ${inputs.length}`,kind:'chat',spoiler:false}],communityVotes:[{personaId:id,recommended:true}]},usage:{total_tokens:10}};
    }},
  });
  clearInterval(s.timer);
  t.after(()=>s.close());
  assert.equal(s.social.enabled(),false);
  s.ai.update({background:true});
  const visit=async(ms=60001)=>{now+=ms;s.pump();await s.communityActivity.active?.promise;assert.equal(s.communityActivity.lastError,'');};
  const clip=()=>clips.create({title:'합성 퍼즐 클립',game:'퍼즐',scene:'마지막 조각을 맞췄다',participants:[],messages:[{id:randomUUID(),personaId:'streamer',name:'방장',kind:'streamer',text:'드디어 맞췄다',time:now}],sessionId:randomUUID(),source:'spectator'});
  const peers=(id,count)=>Array.from({length:count},(_,i)=>clips.comment(id,{name:'방장',text:`공개 합성 댓글 ${i}`}));
  return {s,clips,clip,peers,visit,inputs,get calls(){return inputs.length;},get now(){return now;}};
}

test('a reader posting the 31st clip comment cannot manufacture another visit after cooldown',async t=>{
  const f=fixture(t),c=f.clip();f.peers(c.id,30);
  await f.visit();
  assert.equal(f.calls,1);
  assert.equal(f.clips.get(c.id).comments.length,31);
  assert.deepEqual(f.clips.get(c.id).votes,['momo']);
  await f.visit(COMMUNITY_COOLDOWN+1);
  assert.equal(f.calls,1,'the author has not received any new outside content');
  assert.equal(f.clips.get(c.id).comments.length,31);
  f.clips.commentBatch(c.id,[],{votes:[{personaId:'momo',recommended:false}]});
  await f.visit(COMMUNITY_COOLDOWN+1);
  assert.equal(f.calls,1,'changing the author recommendation is not new discussion');
  assert.deepEqual(f.clips.get(c.id).votes,[]);
});

test('another viewer can discover the first viewer comment without sending its author back to the same clip',async t=>{
  const f=fixture(t,{ids:['momo','gg']}),c=f.clip();f.peers(c.id,35);
  await f.visit();
  assert.equal(f.inputs[0].settings.personas[0].id,'momo');
  const own=f.clips.get(c.id).comments.at(-1);
  await f.visit(COMMUNITY_COOLDOWN+1);
  assert.equal(f.calls,2);
  assert.equal(f.inputs[1].settings.personas[0].id,'gg','the cache must exclude each reader own content separately');
  assert.ok(f.inputs[1].special.clip.comments.some(row=>row.id===own.id));
  assert.deepEqual(f.clips.data[0].activityReads.map(row=>row.viewerId),['momo','gg']);
});

test('deleting the reader own comment does not make an older peer comment look newly posted',async t=>{
  const f=fixture(t,{silent:true}),c=f.clip();f.peers(c.id,1);
  const own=f.clips.comment(c.id,{name:'가상 모모',personaId:'momo',kind:'ai',text:'예전에 남긴 자기 댓글'});
  f.peers(c.id,29);
  await f.visit();
  assert.equal(f.calls,1);
  f.clips.removeComment(c.id,own.id);
  await f.visit(COMMUNITY_COOLDOWN+1);
  assert.equal(f.calls,1,'deleting own words is not a new message from another viewer');
  assert.equal(f.clips.get(c.id).comments.find(row=>row.id===own.id).deleted,true);
});

test('discovery of a real streamer reply stays live while comments outside the actual reading window stay unknown',async t=>{
  const f=fixture(t),c=f.clip(),peers=f.peers(c.id,35);
  await f.visit();
  const hidden=peers[0];
  assert.equal(f.inputs[0].special.clip.comments.length,30);
  assert.ok(!f.inputs[0].special.clip.comments.some(row=>row.id===hidden.id));
  assert.ok(!f.clips.data[0].readings[0].comments.some(row=>row.id===hidden.id));
  assert.ok(!f.clips.recall('momo',hidden.text).flatMap(row=>row.items).some(row=>row.id===hidden.id));
  await f.visit(COMMUNITY_COOLDOWN+1);
  assert.equal(f.calls,1);
  const added=f.clips.comment(c.id,{name:'방장',text:'스트리머가 새로 남긴 퍼즐 이야기'});
  await f.visit(60001);
  assert.equal(f.calls,2,'a new third-party reply remains a discovery reason');
  assert.ok(f.inputs[1].special.clip.comments.some(row=>row.id===added.id));
  const receipt=f.clips.data[0].readings[0];
  assert.ok(receipt.comments.some(row=>row.id===added.id));
  assert.ok(!receipt.comments.some(row=>row.id===hidden.id),'a discovery fingerprint must not grant experience');
  await f.visit(COMMUNITY_COOLDOWN+1);
  assert.equal(f.calls,2);
});

test('gallery own replies and recommendations keep their existing behavior while outside replies remain discoverable',async t=>{
  const f=fixture(t),post=f.s.community.post({title:'합성 일정',text:'가상 방송 일정입니다.'});
  for(let i=0;i<35;i++)f.s.community.comment(post.id,{text:`합성 게시판 댓글 ${i}`});
  await f.visit();
  assert.equal(f.calls,1);
  assert.equal(f.s.community.get(post.id).comments.length,36);
  f.s.community.recommend(post.id,true);
  await f.visit(COMMUNITY_COOLDOWN+1);
  assert.equal(f.calls,1);
  f.s.community.comment(post.id,{text:'방장의 새 일정 답글'});
  await f.visit(60001);
  assert.equal(f.calls,2);
  assert.ok(f.inputs[1].special.post.comments.some(row=>row.text==='방장의 새 일정 답글'));
  await f.visit(COMMUNITY_COOLDOWN+1);
  assert.equal(f.calls,2);
});

test('persisted clip and audience receipts prevent own-comment revisits after an actual store restart',async t=>{
  const evidenceRoot=resolve('artifacts/community-revisit-tests');mkdirSync(evidenceRoot,{recursive:true});
  const dir=mkdtempSync(join(evidenceRoot,'run-'));
  const first=fixture(t,{dir}),c=first.clip();first.peers(c.id,35);
  await first.visit();
  const savedBytes=readFileSync(join(dir,'clips.json'));
  const before=JSON.parse(savedBytes.toString('utf8'))[0];
  assert.equal(first.calls,1);
  await first.s.close();
  const restarted=fixture(t,{dir,initialNow:first.now});
  assert.deepEqual(restarted.clips.data[0],before,'stored comments, votes and personal read receipts must survive unchanged');
  await restarted.visit(COMMUNITY_COOLDOWN+1);
  assert.equal(restarted.calls,0,'restart is not a new reason to read own words');
  assert.deepEqual(restarted.clips.data[0],before);
  assert.deepEqual(readFileSync(join(dir,'clips.json')),savedBytes,'reading a saved receipt must not rewrite the clip store');
  writeFileSync(join(dir,'result.json'),JSON.stringify({status:'PASS',callsBeforeRestart:first.calls,callsAfterRestart:restarted.calls,clipId:c.id,readers:before.activityReads.map(row=>row.viewerId),unchangedClips:true},null,2));
});

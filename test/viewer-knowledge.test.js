import test from 'node:test';
import assert from 'node:assert/strict';
import {Knowledge} from '../server/knowledge.js';
import {Studio} from '../server/studio.js';
import {defaults} from '../shared/defaults.js';
import {KnowledgeData} from '../server/data-schema.js';
import {viewerKnowledge,viewerKnowledgeByPersona,generalFamiliarity,personalFamiliarity,liveViewerContext} from '../server/viewer-context.js';
import {OpenAIProvider} from '../server/provider.js';
import {Settings} from '../server/schema.js';

const img='data:image/png;base64,AAAA';
const liveSettings=(extra={})=>({...defaults,mode:'live',lurkRatio:0,intervalSeconds:5,...extra});

// ── 개인별 지식 격리 (신규 관객) ────────────────────────────────────────────────
test('newcomer gets no witnessed scenes, no watch time, and none of another viewer\'s personal memories',()=>{
  const k=new Knowledge();
  k.observe('Hades','문 앞 전투',1000,0.6,['momo']);
  k.observe('Hades','타르타로스 탈출',4000,0.6,['momo']); // momo 목격, +3s
  const entry=k.get('Hades',0.6);
  const packets=viewerKnowledgeByPersona(entry,[{id:'momo',expertise:0.7},{id:'new',expertise:0.2}],{popularity:0.6});
  assert.ok(packets.momo.firstHand&&packets.momo.witnessed.length>=1);
  const newbie=packets.new;
  assert.equal(newbie.firstHand,false);
  assert.equal(newbie.witnessed.length,0);
  assert.equal(newbie.watchedSeconds,0);
  assert.equal(newbie.personalFamiliarity,0);
  // 다른 관객이 목격한 장면이 신규 관객의 개인 기억이나 공용 배경으로 새지 않는다.
  assert.ok(!newbie.witnessed.some(w=>w.text==='타르타로스 탈출'));
  assert.ok(!newbie.priorScenes.includes('타르타로스 탈출'));
});

// ── 재방문 관객 + 재시작 후 provenance/개인 시청시간 유지 + 오프라인 미집계 ─────────────
test('per-viewer watch time and scene provenance survive a restart and never count offline time',()=>{
  let store={};
  const k=new Knowledge({},(e)=>{store=structuredClone(KnowledgeData.parse(e));}); // 저장 시 실제 영속 스키마로 검증
  k.observe('Celeste','챕터1 시작',1000,0.5,['momo','gg']); // gap0
  k.observe('Celeste','챕터1 딸기',5000,0.5,['momo','gg']); // +4s (momo,gg)
  k.lastSeen=null; // 방송 중지 == studio.stop 이 knowledge.lastSeen 를 비운다
  k.observe('Celeste','챕터2',10_000_000,0.5,['momo']); // 재시작 첫 관찰: lastSeen 없음 → 오프라인 gap 0 집계
  assert.equal(k.get('Celeste').watched.momo,4);
  assert.equal(k.get('Celeste').watched.gg,4);

  const restarted=new Knowledge(structuredClone(store)); // 프로세스 재시작 모사
  const entry=restarted.get('Celeste',0.5);
  const momo=viewerKnowledge(entry,{viewerId:'momo'});
  const gg=viewerKnowledge(entry,{viewerId:'gg'});
  assert.equal(momo.watchedSeconds,4);
  assert.ok(momo.witnessed.some(w=>w.text==='챕터2'),'returning viewer keeps first-hand memory across restart');
  assert.ok(!gg.witnessed.some(w=>w.text==='챕터2'),'a viewer absent for a scene never gains it');
});

test('watch-time gaps are bounded so a single slow frame cannot inflate familiarity',()=>{
  const k=new Knowledge();
  k.observe('Baba','규칙 밀기',0,0.4,['momo']); // gap0
  k.observe('Baba','다음 퍼즐',100000,0.4,['momo']); // 100s → 60s 로 상한
  assert.equal(k.get('Baba').watched.momo,60);
});

// ── 레거시 마이그레이션 정직성 ───────────────────────────────────────────────────
test('legacy records without provenance are never presented as personally witnessed',()=>{
  const legacy={hades:{name:'Hades',seconds:3600,observations:[{id:'a',text:'옛 장면',at:1}],notes:[{id:'n',text:'스트리머가 알려준 팁',at:2}]}};
  const parsed=KnowledgeData.parse(structuredClone(legacy)); // 기존 데이터 파일이 새 스키마에서도 유효해야 한다
  const k=new Knowledge(parsed);
  const entry=k.get('Hades',0.6);
  const anyone=viewerKnowledge(entry,{viewerId:'momo',expertise:0.5,popularity:0.6});
  assert.equal(anyone.firstHand,false);
  assert.equal(anyone.witnessed.length,0,'legacy scene is not a personal memory for anyone');
  assert.deepEqual(anyone.priorScenes,['옛 장면'],'legacy scene surfaces only as shared, unattributed background');
  assert.deepEqual(anyone.taughtNotes,['스트리머가 알려준 팁'],'streamer-taught notes stay distinguished from observations');
  // 새 관찰이 레거시 장면을 소급해 개인 목격으로 승격시키지 않는다.
  k.observe('Hades','새 장면',1000,0.6,['momo']);
  const after=viewerKnowledge(k.get('Hades',0.6),{viewerId:'momo'});
  assert.ok(after.witnessed.some(w=>w.text==='새 장면'));
  assert.ok(!after.witnessed.some(w=>w.text==='옛 장면'));
});

// ── 일반 배경(인지도+숙련도) vs 개인 숙지도(본인 시청시간) 분리 ──────────────────────
test('general familiarity tracks popularity+expertise while personal familiarity tracks own watch time',()=>{
  const entry={name:'EldenRing',observations:[],notes:[],watched:{pro:3600}};
  const pro=viewerKnowledge(entry,{viewerId:'pro',expertise:0.9,popularity:0.8});
  const novice=viewerKnowledge(entry,{viewerId:'novice',expertise:0.1,popularity:0.8});
  assert.ok(pro.generalFamiliarity>novice.generalFamiliarity,'higher expertise lifts baseline at equal game popularity');
  assert.equal(pro.personalFamiliarity,0.3,'1h of own watch time → log2(2)*0.3');
  assert.equal(novice.personalFamiliarity,0,'never watched → no personal familiarity');
  assert.ok(Math.abs(generalFamiliarity(0.8,0.1)-0.36)<1e-9);
  assert.ok(Math.abs(personalFamiliarity(3600)-0.3)<1e-9);
});

// ── studio: 캡처 시점 목격자 스냅샷 + 제외 규칙 (오프스크린/저신뢰/저스트채팅) ───────────
test('live observation records capture-time witnesses; offscreen, low-confidence and just-chatting do not grant knowledge',async t=>{
  let now=100000;
  const observation={game:'Test',scene:'boss appears',confidence:0.9,excitement:0.4,messages:[]};
  const provider={status:()=>({configured:true}),react:async()=>({observation:structuredClone(observation),usage:{total_tokens:1}})};
  const knowledge=new Knowledge();
  const studio=new Studio({provider,knowledge,now:()=>now,random:()=>0,settings:liveSettings()});
  t.after(()=>studio.close());
  studio.start();

  await studio.react({image:img,speech:'첫 관찰'});
  const first=knowledge.get('Test');
  assert.deepEqual([...first.observations[0].witnesses].sort(),['gg','luna','momo','new','pop']);
  assert.doesNotThrow(()=>KnowledgeData.parse(knowledge.entries),'observed entries validate against the persisted schema');

  now+=3000;await studio.react({image:img,speech:'같은 장면'}); // 같은 scene → 재기록 X, 하지만 시청시간 누적
  assert.equal(knowledge.get('Test').watched.momo,3);
  assert.equal(knowledge.get('Test').watched.gg,3);

  now+=3000;provider.react=async()=>({observation:{...observation,scene:'low conf',confidence:0.5},usage:{}});
  await studio.react({image:img,speech:'저신뢰'});
  assert.ok(!knowledge.get('Test').observations.some(o=>o.text==='low conf'),'low confidence is not witnessed');

  now+=3000;provider.react=async()=>({observation:{...observation,scene:'offscreen',confidence:0.95},usage:{}});
  await studio.react({speech:'화면 없이 말만'}); // image 없음
  assert.ok(!knowledge.get('Test').observations.some(o=>o.text==='offscreen'),'no image means no witnessed observation');
});

test('a delayed reply attributes the frame to the capture-time snapshot, not who is present when it returns',async t=>{
  let now=100000;const knowledge=new Knowledge();let studio;
  const provider={status:()=>({configured:true}),react:async()=>{
    studio.audience.presence.new='active'; // 응답 도중 뒤늦게 입장
    studio.audience.presence.momo='away';  // 응답 도중 이탈
    now+=9000; // 모델 지연은 캡처 시각을 바꾸면 안 된다.
    return {observation:{game:'Test',scene:'클러치',confidence:0.9,excitement:0.5,messages:[]},usage:{}};
  }};
  studio=new Studio({provider,knowledge,now:()=>now,random:()=>0,settings:liveSettings()});
  t.after(()=>studio.close());
  studio.start();
  studio.audience.presence.new='away'; // 캡처 시점엔 아직 자리에 없음
  await studio.react({image:img,speech:'관찰'});
  const w=knowledge.get('Test').observations[0].witnesses;
  assert.ok(w.includes('momo'),'present at capture counts even though it left during the reply');
  assert.ok(!w.includes('new'),'arrived only during the reply → not a witness');
  assert.equal(knowledge.get('Test').observations[0].at,100000);
  assert.equal(studio.observation.at,100000);
});

test('new arrivals get no preceding watch interval and repeated scenes get their own witness timestamp',()=>{
  const k=new Knowledge();k.observe('Test','same scene',1000,.5,['momo']);k.observe('Test','same scene',11000,.5,['momo','new']);
  const entry=k.get('Test');assert.equal(entry.watched.momo,10);assert.equal(entry.watched.new||0,0);
  const newcomer=viewerKnowledge(entry,{viewerId:'new'});assert.deepEqual(newcomer.witnessed,[{text:'same scene',at:11000}]);
  assert.deepEqual(entry.observations[0].witnesses,['momo']);k.observe('Test','same scene',14000,.5,['momo','new']);assert.equal(k.get('Test').watched.new,3);
});

test('live model payload removes shared history and routes entry-filtered chat and own memory by persona',()=>{
  const history=[{id:'old',text:'입장 전에 클러치했다',time:100},{id:'recent',text:'어서 와',time:300}];
  const audience={eligible:['momo','new'],members:[{id:'momo',joinedAt:50,memories:['모모만의 기억']},{id:'new',joinedAt:250,memories:[]},{id:'away',joinedAt:1,memories:['떠난 관객만의 기억']}],lore:[],offStreamPosts:[]};
  const personas=Settings.parse(defaults).personas.filter(p=>['momo','new'].includes(p.id));
  const personal=liveViewerContext(audience,personas,history,{scene:'과거 클러치',at:200});
  assert.deepEqual(personal.viewerContext.new.chatHistory,[history[1]]);assert.equal(personal.viewerContext.new.previous,null);assert.deepEqual(personal.viewerContext.new.memories,[]);
  assert.equal(personal.viewerContext.momo.chatHistory.length,2);assert.equal(personal.viewerContext.momo.previous.scene,'과거 클러치');
  assert.ok(personal.audience.members.every(m=>!Object.hasOwn(m,'memories')));assert.ok(!JSON.stringify(personal).includes('떠난 관객만의 기억'));
  const payload=new OpenAIProvider({}).payload({settings:Settings.parse(defaults),history,previous:{scene:'shared old scene'},speech:'지금 말',...personal});
  const data=JSON.parse(payload.input[0].content[0].text);assert.equal(data.chatHistory,undefined);assert.equal(data.previous,undefined);assert.deepEqual(data.viewerContext.new.chatHistory,[history[1]]);
});

test('Just Chatting and replies from a stopped session never record game knowledge',async t=>{
  let now=100000;const knowledge=new Knowledge();let release;
  const provider={status:()=>({configured:true}),react:async()=>({observation:{game:'Test',scene:'visual conversation',confidence:.99,excitement:0,messages:[]},usage:{}})};
  const studio=new Studio({provider,knowledge,now:()=>now,random:()=>0,settings:liveSettings({category:'just-chatting'})});t.after(()=>studio.close());studio.start();await studio.react({image:img,speech:'안녕하세요'});assert.deepEqual(knowledge.entries,{});
  studio.stop();studio.configure({...studio.settings,category:'gaming'});now+=3000;studio.start();provider.react=()=>new Promise(r=>release=r);const pending=studio.react({image:img,speech:'보여요?'});studio.stop();release({observation:{game:'Test',scene:'late frame',confidence:1,excitement:0,messages:[]},usage:{}});await pending;assert.deepEqual(knowledge.entries,{});
});

// ── studio: 가상 기획 방송(directed fantasy)은 개인 목격 지식을 만들지 않는다 ──────────────
test('directed fantasy frames never become personally witnessed game knowledge',async t=>{
  let now=100000;const knowledge=new Knowledge();
  const provider={status:()=>({configured:true}),react:async()=>({observation:{game:'Test',scene:'fantasy boss',confidence:0.95,excitement:0.9,messages:[]},usage:{}})};
  const studio=new Studio({provider,knowledge,now:()=>now,random:()=>0,settings:liveSettings()});
  t.after(()=>studio.close());
  studio.start();
  studio.director.active={id:'ep1',episodeId:'x',title:'가상 기획',premise:'',cast:[],sessionId:studio.sessionId,sessionStartedAt:studio.startedAt,startedAt:now,stage:0,stageTitle:'무대',totalStages:1,messages:[],choices:[],status:'active'};
  await studio.react({image:img,speech:'기획 중'});
  assert.equal(knowledge.get('Test').observations.length,0,'a fantasy scene must not become a witnessed observation');
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {Knowledge} from '../server/knowledge.js';
import {KnowledgeData} from '../server/data-schema.js';

// 실패를 토글할 수 있는 저장 어댑터. 영속 스키마(KnowledgeData)로 검증까지 수행해
// 실제 JsonStore 경로와 같은 조건(사본 검증)에서 커밋 의미를 확인한다.
const savers=()=>{const state={fail:false,calls:0,last:null};
  const save=(e)=>{state.calls++;if(state.fail)throw new Error('disk full');state.last=structuredClone(KnowledgeData.parse(e));};
  return {state,save};};

// ── 저장 실패 시 in-memory 상태를 건드리지 않는다 (observe/teach/forget) ──────────────

test('a failed save in observe commits nothing: no entry, no time, no capture-state advance',()=>{
  const {state,save}=savers();const k=new Knowledge({},save);
  state.fail=true;
  assert.throws(()=>k.observe('Hades','문 앞 전투',1000,0.6,['momo']),/disk full/);
  assert.deepEqual(k.entries,{},'a rejected write leaves the entries map untouched');
  assert.equal(k.lastSeen,null,'a rejected write must not advance capture state');
  assert.equal(k.get('Hades').observations.length,0);
});

test('a failed save in teach leaves notes unchanged',()=>{
  const {state,save}=savers();const k=new Knowledge({},save);
  k.teach('Hades','스트리머 팁');               // 성공
  assert.equal(k.get('Hades').notes.length,1);
  const committed=structuredClone(k.entries);
  state.fail=true;
  assert.throws(()=>k.teach('Hades','두번째 팁'),/disk full/);
  assert.equal(k.get('Hades').notes.length,1,'a rejected teach adds no note');
  assert.deepEqual(k.entries,committed,'the committed map is byte-for-byte unchanged after a failed teach');
});

test('a failed save in forget keeps the entry and the capture clock',()=>{
  const {state,save}=savers();const k=new Knowledge({},save);
  k.observe('Celeste','챕터1',1000,0.5,['momo']); // lastSeen 확정
  const seen=structuredClone(k.lastSeen);
  state.fail=true;
  assert.throws(()=>k.forget('Celeste'),/disk full/);
  assert.ok(k.get('Celeste').observations.length>=1,'a rejected forget must not delete the entry');
  assert.deepEqual(k.lastSeen,seen,'a rejected forget must not clear lastSeen');
  state.fail=false;
  k.forget('Celeste');
  assert.equal(k.get('Celeste').observations.length,0,'a committed forget removes the entry');
  assert.equal(k.lastSeen,null,'a committed forget clears lastSeen only on success');
});

// ── 저장 어댑터가 인자를 변형해도 커밋 상태가 오염되지 않는다 ────────────────────────────

test('a mutating save adapter cannot corrupt the committed state',()=>{
  // 넘겨받은 맵과 그 하위 엔트리를 적극적으로 망가뜨리고 새 키까지 주입하는 적대적 어댑터.
  const save=(e)=>{for(const key of Object.keys(e)){e[key].seconds=99999;e[key].observations.length=0;delete e[key].watched;e[key].notes.push({id:'bad',text:'주입',at:0});}
    e.injected={name:'x',seconds:0,observations:[],notes:[]};};
  const k=new Knowledge({},save);
  k.observe('Celeste','s1',1000,0.5,['momo']);
  k.observe('Celeste','s2',5000,0.5,['momo']); // +4s
  const entry=k.get('Celeste');
  assert.equal(entry.seconds,4,'adapter mutation did not leak into committed seconds');
  assert.equal(entry.observations.length,2,'adapter did not clear committed observations');
  assert.equal(entry.watched.momo,4,'adapter did not drop committed watch time');
  assert.ok(!Object.hasOwn(k.entries,'injected'),'keys the adapter injected into its copy never appear in committed state');
  // teach 경로도 동일하게 격리된다.
  k.teach('Celeste','노트');
  assert.equal(k.get('Celeste').notes.length,1);
  assert.ok(!Object.hasOwn(k.entries,'injected'));
});

// ── 프로토타입 오염 방지: 위험한 게임명도 own 데이터 키로 격리된다 ──────────────────────────

test('prototype-like game titles stay isolated own keys and never pollute Object.prototype',()=>{
  const {state,save}=savers();const k=new Knowledge({},save);
  for(const name of ['__proto__','constructor','prototype']){
    k.teach(name,'note:'+name);
    k.observe(name,'scene:'+name,1000,0.5,['momo']);
  }
  for(const name of ['__proto__','constructor','prototype']){
    assert.equal(k.get(name).notes[0].text,'note:'+name,`${name} is retrievable as an own data key`);
    assert.ok(k.get(name).observations.some(o=>o.text==='scene:'+name));
  }
  assert.equal(({}).notes,undefined,'Object.prototype.notes was not polluted');
  assert.equal(({}).seconds,undefined,'Object.prototype.seconds was not polluted');
  assert.equal(Object.getPrototypeOf(k.entries),Object.prototype,'the entries map keeps a normal prototype');
  // 실패한 쓰기도 위험한 키에서 프로토타입을 오염시키지 않는다.
  state.fail=true;
  assert.throws(()=>k.observe('__proto__','again',2000,0.5,['gg']),/disk full/);
  assert.equal(({}).seconds,undefined);
});

test('unusual unicode and whitespace game keys normalize and survive the commit path',()=>{
  const {state,save}=savers();const k=new Knowledge({},save);
  k.teach('  Ｈａｄｅｓ  ','풀와이드 노트'); // NFKC + trim + lower → 'hades'
  assert.equal(k.get('Hades').notes[0].text,'풀와이드 노트','fullwidth/whitespace key normalizes to the same entry');
  assert.ok(Object.hasOwn(state.last,'hades'),'the persisted map carries the normalized key');
});

// ── 재시도: 실패 후 성공한 저장이 상태를 일관되게 커밋한다 ───────────────────────────────

test('a retry after an injected failure commits the accumulated state exactly once-consistent',()=>{
  const {state,save}=savers();const k=new Knowledge({},save);
  state.fail=true;
  assert.throws(()=>k.teach('Baba','규칙'),/disk full/);
  assert.equal(k.get('Baba').notes.length,0,'the failed attempt left no trace');
  state.fail=false;
  k.teach('Baba','규칙');               // 재시도 성공
  assert.equal(k.get('Baba').notes.length,1);
  assert.ok(Object.hasOwn(state.last,'baba'),'the retry actually persisted the entry');
  assert.doesNotThrow(()=>KnowledgeData.parse(k.entries),'committed state stays schema-valid across a retry');
});

// ── 시계/시청 상태: 실패한 쓰기는 시간을 세지 않고, 재시도는 마지막 커밋된 캡처부터 센다 ──────────

test('a failed observe counts no time and does not advance the capture clock; the next success counts from the last committed capture',()=>{
  const {state,save}=savers();const k=new Knowledge({},save);
  k.observe('Celeste','s1',1000,0.5,['momo']); // gap0, lastSeen@1000
  k.observe('Celeste','s2',5000,0.5,['momo']); // +4s, lastSeen@5000
  assert.equal(k.get('Celeste').watched.momo,4);
  assert.equal(k.lastSeen.at,5000);

  state.fail=true;
  assert.throws(()=>k.observe('Celeste','s3',9000,0.5,['momo']),/disk full/);
  assert.equal(k.get('Celeste').watched.momo,4,'a rejected observe counts no watch time');
  assert.equal(k.get('Celeste').observations.length,2,'a rejected observe records no scene');
  assert.equal(k.lastSeen.at,5000,'a rejected observe does not advance the capture clock');

  state.fail=false;
  k.observe('Celeste','s4',12000,0.5,['momo']); // gap from last COMMITTED capture(5000) → 7s
  assert.equal(k.get('Celeste').watched.momo,11,'the retry counts the interval since the last committed capture');
  assert.equal(k.lastSeen.at,12000);
  assert.equal(k.get('Celeste').observations.length,3);
});

test('per-viewer watch map still caps at 80 keys after the save-before-commit change',()=>{
  const k=new Knowledge();let at=0;
  // observe 는 한 번에 목격자 40명까지만, 그리고 직전/현재 두 관찰에 모두 있는 목격자에게만 시간을 준다.
  // 40명씩 겹치는 라운드를 세 번 돌려 120명에게 시청 시간을 누적시키면, capWatched 가 상위 80명만 유지해야 한다.
  for(let round=0;round<3;round++){
    const set=Array.from({length:40},(_,i)=>'v'+(round*40+i));
    k.observe('Cap','s'+round+'a',at,0.5,set);at+=5000; // 직전 집합과 겹치지 않으므로 시간 미부여, lastSeen 갱신
    k.observe('Cap','s'+round+'b',at,0.5,set);at+=5000; // 같은 집합 → 40명에게 시청 시간 누적
  }
  assert.equal(Object.keys(k.get('Cap').watched).length,80,'watch map is capped at 80 keys');
});

// ── 스키마 역호환: 새 커밋 경로가 저장하는 값은 기존 영속 스키마를 만족한다 ────────────────────

test('the value handed to save validates against the backwards-compatible KnowledgeData schema',()=>{
  const {state,save}=savers();const k=new Knowledge({},save);
  k.observe('Hades','보스 등장',1000,0.6,['momo','gg']);
  k.teach('Hades','전설의 팁');
  assert.ok(state.calls>=2,'save ran on every committed mutation');
  assert.doesNotThrow(()=>KnowledgeData.parse(state.last),'the persisted payload is schema-valid');
  // optional 필드(witnesses/watched)는 스키마 역호환을 유지한다.
  const entry=state.last.hades;
  assert.ok(Array.isArray(entry.observations[0].witnesses));
  assert.equal(typeof entry.watched,'object');
});

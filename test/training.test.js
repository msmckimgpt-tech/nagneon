import test from 'node:test';
import assert from 'node:assert/strict';
import {TrainingRun,SCENARIOS,STAGE_INTERVAL_MS} from '../server/training.js';

// momo/gg speak; luna is the manager and lurker is disabled — neither may appear.
const personas=[
  {id:'momo',name:'모모',color:'#a89bff',role:'viewer',enabled:true},
  {id:'gg',name:'각보는고양이',color:'#ffbd78',role:'viewer',enabled:true},
  {id:'luna',name:'루나',color:'#99d9af',role:'manager',enabled:true},
  {id:'lurker',name:'잠수',color:'#8bcdd2',role:'viewer',enabled:false}
];
const speakers=new Set(['momo','gg']);

test('catalog covers the required situations and every scenario is well formed',()=>{
  const required=['opening','quiet','repeated-failure','backseat-advice','disagreement','influx','spoiler-boundary','personal-boundary','donation-pressure','criticism','technical-glitch','ending'];
  const ids=new Set(SCENARIOS.map(s=>s.id));
  assert.ok(SCENARIOS.length>=12,'12개 이상의 시나리오가 필요합니다');
  for(const id of required)assert.ok(ids.has(id),`빠진 시나리오: ${id}`);
  for(const s of SCENARIOS){
    assert.ok(s.id&&s.title&&s.description&&s.objective.length>0);
    assert.ok(s.prompts.length>=2&&s.prompts.length<=4,`${s.id} 프롬프트 개수`);
    assert.ok(s.reflection.length>=1);
  }
  // snapshot's catalog exposes only the public projection, never staged prompts.
  const catalog=new TrainingRun().snapshot().catalog;
  assert.equal(catalog.length,SCENARIOS.length);
  for(const s of catalog){assert.equal(s.prompts,undefined);assert.equal(s.reflection,undefined);}
});

test('staged chat is released over time from enabled non-manager personas only',()=>{
  let now=1000;const t=new TrainingRun({now:()=>now});
  const opening=SCENARIOS.find(s=>s.id==='opening');
  t.start('opening',personas);
  const first=t.tick();
  assert.equal(first.length,1);assert.equal(first[0].kind,'chat');assert.ok(speakers.has(first[0].personaId));
  assert.equal(t.tick().length,0,'같은 순간에 두 번째 채팅이 나오면 안 됩니다');
  now+=STAGE_INTERVAL_MS-1;assert.equal(t.tick().length,0,'간격이 차기 전에는 나오지 않습니다');
  now+=1;const second=t.tick();
  assert.equal(second.length,1);assert.ok(speakers.has(second[0].personaId));
  // drain every remaining staged prompt (one per interval).
  let guard=0;while(t.snapshot().eventsSent<opening.prompts.length&&guard<20){now+=STAGE_INTERVAL_MS;t.tick();guard++;}
  assert.equal(t.snapshot().eventsSent,opening.prompts.length);
  // a finite scenario cannot emit forever, even after a long wait.
  now+=STAGE_INTERVAL_MS*100;
  let extra=0;for(let i=0;i<5;i++){now+=STAGE_INTERVAL_MS;extra+=t.tick().length;}
  assert.equal(extra,0,'모든 프롬프트를 내보낸 뒤에는 채팅이 없습니다');
});

test('a long sleep does not flood the chat on wake',()=>{
  let now=1000;const t=new TrainingRun({now:()=>now});
  t.start('opening',personas);
  now+=STAGE_INTERVAL_MS*1000; // machine slept
  assert.equal(t.tick().length,1,'깨어난 뒤에도 한 번에 하나만 나옵니다');
  assert.equal(t.tick().length,0,'몰아서 쏟아지지 않습니다');
});

test('an unknown scenario id is refused and a run cannot start twice',()=>{
  const t=new TrainingRun({now:()=>1});
  assert.throws(()=>t.start('does-not-exist',personas),/찾을 수 없/);
  t.start('quiet',personas);
  assert.throws(()=>t.start('opening',personas),/이미 진행/);
});

test('stop cancels all future staged events',()=>{
  let now=1000;const t=new TrainingRun({now:()=>now});
  t.start('opening',personas);
  assert.equal(t.tick().length,1);
  t.stop();
  now+=STAGE_INTERVAL_MS*5;
  assert.equal(t.tick().length,0);
  assert.equal(t.snapshot().active,false);
  assert.equal(t.snapshot().scenario,null);
});

test('disabled and manager personas never speak',()=>{
  let now=1000;const t=new TrainingRun({now:()=>now});
  t.start('opening',[personas[2],personas[3]]); // only manager + disabled viewer
  assert.equal(t.tick().length,0);
  now+=STAGE_INTERVAL_MS*3;
  assert.equal(t.tick().length,0);
  assert.equal(t.snapshot().eventsSent,0);
});

test('stop reports observed counts and duration without grading anything',()=>{
  let now=5000;const t=new TrainingRun({now:()=>now});
  t.start('criticism',personas);
  assert.throws(()=>new TrainingRun({now:()=>1}).action('response'),/진행 중인 연습/);
  t.action('response','침착하게 응답');
  t.action('response','다시 응답');
  t.action('checklist');
  t.action('moderation');
  now+=55000;
  const report=t.stop();
  assert.equal(report.responses,2);
  assert.equal(report.checklist,1);
  assert.equal(report.moderations,1);
  assert.equal(report.totalActions,4);
  assert.equal(report.durationMs,55000);
  assert.deepEqual(report.actionCounts,{response:2,checklist:1,moderation:1});
  assert.ok(Array.isArray(report.reflection)&&report.reflection.length>0);
  assert.match(report.disclaimer,/평가/);
  // never pretends to semantically grade empathy or success.
  assert.equal(report.score,undefined);
  assert.equal(report.success,undefined);
  assert.equal(report.grade,undefined);
  assert.equal(report.empathy,undefined);
  // the finished report and counts stay visible in the snapshot.
  const snap=t.snapshot();
  assert.equal(snap.active,false);
  assert.equal(snap.report.totalActions,4);
  assert.equal(snap.actions.length,4);
  // action() and stop() require an active run.
  assert.throws(()=>t.stop(),/진행 중인 연습이 없습니다/);
  assert.throws(()=>t.action('response'),/진행 중인 연습/);
});

test('starting a new run resets counters, actions and the previous report',()=>{
  let now=1000;const t=new TrainingRun({now:()=>now});
  t.start('opening',personas);
  t.tick();t.action('response','x');
  now+=STAGE_INTERVAL_MS;t.tick();
  t.stop();
  assert.ok(t.snapshot().eventsSent>0);
  assert.ok(t.snapshot().report);
  t.start('quiet',personas);
  const snap=t.snapshot();
  assert.equal(snap.active,true);
  assert.equal(snap.scenario.id,'quiet');
  assert.equal(snap.eventsSent,0);
  assert.equal(snap.actions.length,0);
  assert.equal(snap.report,null);
});

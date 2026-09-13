import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import { mkdtempSync, rmSync, writeFileSync, readFileSync, existsSync, readdirSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { z } from 'zod';
import { JsonStore } from '../server/storage.js';

// 실제 임시 파일에서만 테스트하고, 각 테스트 종료 시 자기 폴더만 정리한다.
function tmp(t) { const dir = mkdtempSync(join(tmpdir(), 'jsonstore-')); t.after(() => rmSync(dir, { recursive: true, force: true })); return dir; }

// 대표 validate: 객체가 아니거나 count 가 숫자가 아니면 던지고, 검증된(정규화된) 사본을 반환한다.
const validate = (d) => {
  if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error('객체가 아닙니다.');
  if (typeof d.count !== 'number' || !Number.isFinite(d.count)) throw new Error('count 는 숫자여야 합니다.');
  return { count: d.count, label: typeof d.label === 'string' ? d.label : '' };
};
const opts = (over = {}) => ({ validate, initial: () => ({ count: 0, label: 'init' }), backupCount: 3, ...over });
const num = (p) => JSON.parse(readFileSync(p, 'utf8')).count;

test('short writes preserve UTF-8 bytes and zero-progress writes retain the prior generation',t=>{
  const file=join(tmp(t),'short.json');let zero=false;
  const store=new JsonStore(file,opts({fs:{writeSync:(fd,buffer,offset,length,position)=>zero?0:fs.writeSync(fd,buffer,offset,Math.min(3,length),position)}}));
  store.save({count:1,label:'한국어 관객 기록 🍿'});assert.equal(JSON.parse(readFileSync(file,'utf8')).label,'한국어 관객 기록 🍿');zero=true;
  assert.throws(()=>store.save({count:2,label:'new'}),/진행되지/);assert.equal(num(file),1);assert.equal(existsSync(file+'.tmp'),false);
});

test('생성자는 잘못된 인자를 거부한다', () => {
  assert.throws(() => new JsonStore('', { validate }), /경로/);
  assert.throws(() => new JsonStore('/x', {}), /validate/);
  assert.throws(() => new JsonStore('/x', { validate, backupCount: -1 }), /backupCount/);
  assert.throws(() => new JsonStore('/x', { validate, backupCount: 1.5 }), /backupCount/);
});

test('아무것도 없을 때 load 는 검증된 initial 을 반환하고 디스크를 쓰지 않는다', (t) => {
  const file = join(tmp(t), 's.json');
  const store = new JsonStore(file, opts());
  assert.deepEqual(store.load(), { count: 0, label: 'init' });
  assert.equal(store.recoveredFrom, null);
  assert.deepEqual(store.warnings, []);
  assert.equal(existsSync(file), false);
});

test('save 는 검증·정규화 후 원자적으로 커밋하고 load 로 다시 읽힌다', (t) => {
  const file = join(tmp(t), 's.json');
  const store = new JsonStore(file, opts());
  const out = store.save({ count: 5, label: 'hi', extra: 'dropped' });
  assert.deepEqual(out, { count: 5, label: 'hi' }); // validate 가 미지의 키 제거
  assert.equal(existsSync(file + '.tmp'), false);   // 임시 파일 정리됨
  assert.deepEqual(new JsonStore(file, opts()).load(), { count: 5, label: 'hi' });
});

test('save 는 임시 파일 → fsync → rename 순서로 커밋한다', (t) => {
  const file = join(tmp(t), 's.json');
  const seq = [];
  const spy = {
    openSync: (...a) => { seq.push(['open', String(a[0])]); return fs.openSync(...a); },
    fsyncSync: (...a) => { seq.push(['fsync']); return fs.fsyncSync(...a); },
    renameSync: (...a) => { seq.push(['rename', String(a[0]), String(a[1])]); return fs.renameSync(...a); },
  };
  new JsonStore(file, opts({ fs: spy })).save({ count: 1 });
  const openTmp = seq.findIndex((s) => s[0] === 'open' && s[1].endsWith('.tmp'));
  const fsync = seq.findIndex((s) => s[0] === 'fsync');
  const commit = seq.findIndex((s) => s[0] === 'rename' && s[1].endsWith('.tmp') && s[2] === file);
  assert.ok(openTmp >= 0 && fsync > openTmp && commit > fsync, `순서가 잘못됨: ${JSON.stringify(seq)}`);
});

test('손상된 기본 파일은 최신 유효 백업으로 복구하고 명시적으로 보고한다', (t) => {
  const file = join(tmp(t), 's.json');
  const store = new JsonStore(file, opts({ backupCount: 3 }));
  store.save({ count: 1 }); store.save({ count: 2 }); store.save({ count: 3 }); // primary=3, bak.1=2, bak.2=1
  writeFileSync(file, '{ not json');
  const r = new JsonStore(file, opts({ backupCount: 3 }));
  assert.equal(r.load().count, 2);
  assert.ok(r.recoveredFrom.endsWith('s.json.bak.1'));
  assert.match(r.warnings.join('\n'), /손상되어 백업에서 복구/);
});

test('복구는 손상된 백업을 건너뛰고 다음 유효 백업을 사용한다', (t) => {
  const file = join(tmp(t), 's.json');
  const store = new JsonStore(file, opts({ backupCount: 3 }));
  store.save({ count: 1 }); store.save({ count: 2 }); store.save({ count: 3 }); // primary=3, bak.1=2, bak.2=1
  writeFileSync(file, '{corrupt');
  writeFileSync(file + '.bak.1', '{also corrupt');
  const r = new JsonStore(file, opts({ backupCount: 3 }));
  assert.equal(r.load().count, 1);
  assert.ok(r.recoveredFrom.endsWith('s.json.bak.2'));
  assert.match(r.warnings.join('\n'), /백업이 손상되어 건너뜁니다/);
});

test('스키마 검증에 실패하는(유효 JSON) 기본 파일도 손상으로 보고 복구한다', (t) => {
  const file = join(tmp(t), 's.json');
  const store = new JsonStore(file, opts());
  store.save({ count: 1 }); store.save({ count: 2 }); // primary=2, bak.1=1
  writeFileSync(file, JSON.stringify({ count: 'not-a-number' }));
  const r = new JsonStore(file, opts());
  assert.equal(r.load().count, 1);
  assert.ok(r.recoveredFrom.endsWith('s.json.bak.1'));
});

test('손상된 기본 파일과 유효 백업이 없으면 던지고 절대 초기화/덮어쓰지 않는다', (t) => {
  const file = join(tmp(t), 's.json');
  new JsonStore(file, opts()).save({ count: 1 }); // 백업 없음
  writeFileSync(file, '{corrupt');
  const r = new JsonStore(file, opts());
  assert.throws(() => r.load(), /손상되었고 사용할 수 있는 백업이 없습니다/);
  assert.equal(readFileSync(file, 'utf8'), '{corrupt'); // 원본 그대로 유지
});

test('백업은 최신 순으로 정렬되고 backupCount 로 상한이 유지된다', (t) => {
  const file = join(tmp(t), 's.json');
  const store = new JsonStore(file, opts({ backupCount: 2 }));
  for (const c of [1, 2, 3, 4]) store.save({ count: c });
  assert.equal(num(file), 4);
  assert.equal(num(file + '.bak.1'), 3); // 최신 이전 세대
  assert.equal(num(file + '.bak.2'), 2);
  assert.equal(existsSync(file + '.bak.3'), false); // 상한 초과 없음
});

test('backupCount 0 은 백업을 만들지 않고 복구도 불가능하다', (t) => {
  const file = join(tmp(t), 's.json');
  const store = new JsonStore(file, opts({ backupCount: 0 }));
  store.save({ count: 1 }); store.save({ count: 2 });
  assert.equal(existsSync(file + '.bak.1'), false);
  writeFileSync(file, '{bad');
  assert.throws(() => new JsonStore(file, opts({ backupCount: 0 })).load(), /백업이 없습니다/);
});

test('검증 실패한 save 는 던지고 디스크를 전혀 바꾸지 않는다', (t) => {
  const file = join(tmp(t), 's.json');
  const store = new JsonStore(file, opts());
  store.save({ count: 7, label: 'ok' });
  const before = readFileSync(file, 'utf8');
  assert.throws(() => store.save({ count: 'bad' }), /count/);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(existsSync(file + '.tmp'), false);
  assert.equal(existsSync(file + '.bak.1'), false); // 백업 회전도 일어나지 않음
});

test('반환/저장은 사본이라 호출자의 변형이 저장 내용에 영향을 주지 않는다', (t) => {
  const file = join(tmp(t), 's.json');
  const store = new JsonStore(file, opts());
  const input = { count: 1, label: 'a' };
  store.save(input);
  input.count = 999; input.label = 'mutated'; // 저장 이후 입력 변형
  const a = store.load();
  assert.deepEqual(a, { count: 1, label: 'a' });
  a.count = 555; a.label = 'x'; // 반환값 변형
  assert.deepEqual(store.load(), { count: 1, label: 'a' });
});

test('정리는 경로 한정이며 무관한 파일을 건드리지 않는다', (t) => {
  const dir = tmp(t);
  const file = join(dir, 'main.json');
  writeFileSync(join(dir, 'other.json'), '{"count":9}');
  writeFileSync(join(dir, 'other.json.bak.1'), '{"count":9}'); // 다른 store 의 백업
  writeFileSync(join(dir, 'notes.txt'), 'hello');
  const store = new JsonStore(file, opts({ backupCount: 2 }));
  store.save({ count: 1 }); store.save({ count: 2 }); store.save({ count: 3 });
  writeFileSync(file + '.bak.5', '{"count":0}'); // 이전에 더 컸던 상한의 잔여 백업
  store.save({ count: 4 });
  assert.equal(existsSync(file + '.bak.5'), false); // 잔여 백업 정리됨
  assert.equal(existsSync(file + '.bak.3'), false);
  assert.equal(readFileSync(join(dir, 'other.json'), 'utf8'), '{"count":9}');
  assert.equal(readFileSync(join(dir, 'other.json.bak.1'), 'utf8'), '{"count":9}');
  assert.equal(readFileSync(join(dir, 'notes.txt'), 'utf8'), 'hello');
});

test('복구 후 저장은 손상 원본을 보존하고 새 데이터를 커밋한다', (t) => {
  const dir = tmp(t);
  const file = join(dir, 's.json');
  const s1 = new JsonStore(file, opts());
  s1.save({ count: 1 }); s1.save({ count: 2 }); // primary=2, bak.1=1
  writeFileSync(file, '{corrupt');
  const s2 = new JsonStore(file, opts());
  assert.equal(s2.load().count, 1);
  assert.ok(s2.recoveredFrom.endsWith('s.json.bak.1'));
  s2.save({ count: 10 });
  const preserved = readdirSync(dir).filter((n) => n.startsWith('s.json.corrupt-'));
  assert.equal(preserved.length, 1);
  assert.equal(readFileSync(join(dir, preserved[0]), 'utf8'), '{corrupt'); // 손상 원본 보존
  assert.match(s2.warnings.join('\n'), /손상된 기본 저장 파일을 보존/);
  const s3 = new JsonStore(file, opts());
  assert.equal(s3.load().count, 10); // 새 데이터가 기본 파일
  assert.equal(s3.recoveredFrom, null);
});

test('기본 파일만 사라져도(중단된 저장) 백업에서 복구한다', (t) => {
  const file = join(tmp(t), 's.json');
  const store = new JsonStore(file, opts());
  store.save({ count: 1 }); store.save({ count: 2 }); // primary=2, bak.1=1
  rmSync(file); // 기본 파일 유실
  const r = new JsonStore(file, opts());
  assert.equal(r.load().count, 1);
  assert.ok(r.recoveredFrom.endsWith('s.json.bak.1'));
  assert.match(r.warnings.join('\n'), /없어 백업에서 복구/);
});

test('임시 파일 기록 실패 시 이전 유효 기본 파일이 그대로 유지된다', (t) => {
  const file = join(tmp(t), 's.json');
  let fail = false;
  const adapter = { writeSync: (...a) => { if (fail) throw new Error('disk full'); return fs.writeSync(...a); } };
  const store = new JsonStore(file, opts({ fs: adapter }));
  store.save({ count: 1 });
  const before = readFileSync(file, 'utf8');
  fail = true;
  assert.throws(() => store.save({ count: 2 }), /disk full/);
  assert.equal(readFileSync(file, 'utf8'), before);
  assert.equal(existsSync(file + '.tmp'), false);
  assert.equal(existsSync(file + '.bak.1'), false); // 백업 회전 이전에 실패
});

test('커밋(rename) 실패 시에도 이전 유효 기본 파일이 유지된다', (t) => {
  const file = join(tmp(t), 's.json');
  let fail = false;
  const adapter = { renameSync: (...a) => { if (fail && String(a[0]).endsWith('.tmp')) throw new Error('rename fail'); return fs.renameSync(...a); } };
  const store = new JsonStore(file, opts({ fs: adapter }));
  store.save({ count: 1 });
  const before = readFileSync(file, 'utf8');
  fail = true;
  assert.throws(() => store.save({ count: 2 }), /rename fail/);
  assert.equal(readFileSync(file, 'utf8'), before); // 커밋 실패해도 원본 보존
  assert.equal(existsSync(file + '.tmp'), false);   // 임시 파일 정리됨
});

test('validate 로 zod 스키마를 그대로 사용할 수 있다', (t) => {
  const file = join(tmp(t), 's.json');
  const schema = z.object({ count: z.number().int().min(0), label: z.string().default('') });
  const zopts = { validate: (d) => schema.parse(d), initial: () => ({ count: 0 }) };
  const store = new JsonStore(file, zopts);
  store.save({ count: 3 });
  assert.equal(new JsonStore(file, zopts).load().count, 3);
  assert.throws(() => store.save({ count: -1 })); // 스키마 위반
});

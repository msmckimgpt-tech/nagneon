import test from 'node:test';
import assert from 'node:assert/strict';
import * as fs from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {JsonStore} from '../server/storage.js';

const windows = process.platform === 'win32';
const validate = (value) => {
  assert.ok(Number.isInteger(value.count));
  return {count: value.count};
};
function fixture(t, count = 4) {
  const folder = fs.mkdtempSync(join(tmpdir(), 'storage-rename-'));
  t.after(() => fs.rmSync(folder, {recursive: true, force: true}));
  const file = join(folder, 'records.json');
  const store = new JsonStore(file, {validate});
  for (let value = 1; value <= count; value++) store.save({count: value});
  return {folder, file};
}
const countAt = (file) => JSON.parse(fs.readFileSync(file, 'utf8')).count;
const denied = (attempt) => Object.assign(new Error('commit denied ' + attempt), {code: 'EPERM'});

for (const failures of [1, 2, 3]) {
  test(`transient Windows commit denial ${failures} preserves one write and backup rotation`, (t) => {
    const {file} = fixture(t);
    let attempts = 0, writes = 0, tempSyncs = 0, copies = 0;
    const tempFds = new Set(), errors = [], unlinked = [];
    const store = new JsonStore(file, {validate, fs: {
      openSync: (...args) => {const fd = fs.openSync(...args); if (args[0] === file + '.tmp') tempFds.add(fd); return fd;},
      writeSync: (...args) => {writes++; return fs.writeSync(...args);},
      fsyncSync: (fd) => {if (tempFds.has(fd)) tempSyncs++; return fs.fsyncSync(fd);},
      closeSync: (fd) => {tempFds.delete(fd); return fs.closeSync(fd);},
      copyFileSync: (...args) => {copies++; return fs.copyFileSync(...args);},
      unlinkSync: (target) => {unlinked.push(target); return fs.unlinkSync(target);},
      renameSync: (...args) => {
        if (args[0] === file + '.tmp' && ++attempts <= failures) {const error = denied(attempts); errors.push(error); throw error;}
        return fs.renameSync(...args);
      },
    }});
    assert.deepEqual(store.load(), {count: 4});
    if (windows) {
      const returned = store.save({count: 5});
      assert.deepEqual(returned, {count: 5}); returned.count = 99;
      assert.equal(store._cache.count, 5);
      assert.equal(countAt(file), 5);
      assert.equal(attempts, failures + 1);
      assert.deepEqual(new JsonStore(file, {validate}).load(), {count: 5});
    } else {
      assert.throws(() => store.save({count: 5}), (error) => error === errors[0]);
      assert.equal(attempts, 1); assert.equal(countAt(file), 4); assert.equal(store._cache.count, 4);
    }
    assert.equal(writes, 1); assert.equal(tempSyncs, 1); assert.equal(copies, 1);
    assert.equal(unlinked.includes(file), false, 'Primary must never be deleted to bypass rename denial');
    assert.deepEqual([1, 2, 3].map((n) => countAt(file + '.bak.' + n)), [4, 3, 2]);
    assert.equal(fs.existsSync(file + '.bak.4'), false);
    assert.equal(fs.existsSync(file + '.tmp'), false);
  });
}

test('persistent commit denial has finite attempts and returns the exact final error', (t) => {
  const {file} = fixture(t);
  const before = fs.readFileSync(file), errors = []; let writes = 0, copies = 0;
  const store = new JsonStore(file, {validate, fs: {
    writeSync: (...args) => {writes++; return fs.writeSync(...args);},
    copyFileSync: (...args) => {copies++; return fs.copyFileSync(...args);},
    renameSync: (...args) => {if (args[0] === file + '.tmp') {const error = denied(errors.length + 1); errors.push(error); throw error;} return fs.renameSync(...args);},
  }});
  store.load();
  assert.throws(() => store.save({count: 5}), (error) => error === errors.at(-1));
  assert.equal(errors.length, windows ? 4 : 1);
  assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(store._cache.count, 4);
  assert.equal(writes, 1); assert.equal(copies, 1);
  assert.equal(fs.existsSync(file + '.tmp'), false);
  assert.deepEqual([1, 2, 3].map((n) => countAt(file + '.bak.' + n)), [4, 3, 2]);
  assert.deepEqual(new JsonStore(file, {validate}).load(), {count: 4});
});

for (const code of ['EACCES', 'EBUSY', 'EIO', 'ENOENT', undefined]) {
  test(`other commit error ${String(code)} is propagated immediately`, (t) => {
    const {file} = fixture(t, 1); const before = fs.readFileSync(file); let attempts = 0;
    const expected = Object.assign(new Error('unrelated failure'), code ? {code} : {});
    const store = new JsonStore(file, {validate, fs: {renameSync: (...args) => {
      if (args[0] === file + '.tmp') {attempts++; throw expected;} return fs.renameSync(...args);
    }}});
    assert.throws(() => store.save({count: 2}), (error) => error === expected);
    assert.equal(attempts, 1); assert.deepEqual(fs.readFileSync(file), before);
    assert.equal(fs.existsSync(file + '.tmp'), false);
  });
}

test('a changed failure during retry propagates the current error rather than the first denial', (t) => {
  const {file} = fixture(t, 1); const before = fs.readFileSync(file); const errors = [];
  const store = new JsonStore(file, {validate, fs: {renameSync: (...args) => {
    if (args[0] === file + '.tmp') {
      const error = errors.length ? Object.assign(new Error('disk failure'), {code: 'EIO'}) : denied(1);
      errors.push(error); throw error;
    }
    return fs.renameSync(...args);
  }}});
  store.load(); assert.throws(() => store.save({count: 2}), (error) => error === errors.at(-1));
  assert.equal(errors.length, windows ? 2 : 1);
  assert.equal(errors.at(-1).code, windows ? 'EIO' : 'EPERM');
  assert.equal(store._cache.count, 1); assert.deepEqual(fs.readFileSync(file), before);
  assert.equal(fs.existsSync(file + '.tmp'), false);
});

test('a new store commit and backupCount zero use the same bounded retry', (t) => {
  const {folder} = fixture(t, 0); const file = join(folder, 'new.json'); let attempts = 0;
  const error = denied(1);
  const store = new JsonStore(file, {validate, backupCount: 0, fs: {renameSync: (...args) => {
    if (args[0] === file + '.tmp' && ++attempts <= 3) throw error; return fs.renameSync(...args);
  }}});
  if (windows) {assert.deepEqual(store.save({count: 1}), {count: 1}); assert.equal(countAt(file), 1);}
  else {assert.throws(() => store.save({count: 1}), (e) => e === error); assert.equal(fs.existsSync(file), false);}
  assert.equal(attempts, windows ? 4 : 1);
  assert.equal(fs.existsSync(file + '.tmp'), false);
  assert.equal(fs.existsSync(file + '.bak.1'), false);
});

test('corrupt primary preservation happens once across all commit attempts', (t) => {
  const {folder, file} = fixture(t, 2); const corrupt = '{ corrupt primary'; fs.writeFileSync(file, corrupt);
  let attempts = 0, copies = 0; const error = denied(1);
  const store = new JsonStore(file, {validate, fs: {
    copyFileSync: (...args) => {copies++; return fs.copyFileSync(...args);},
    renameSync: (...args) => {if (args[0] === file + '.tmp' && ++attempts <= 3) throw error; return fs.renameSync(...args);},
  }});
  assert.deepEqual(store.load(), {count: 1});
  if (windows) {assert.deepEqual(store.save({count: 10}), {count: 10}); assert.equal(countAt(file), 10);}
  else {assert.throws(() => store.save({count: 10}), (e) => e === error); assert.equal(fs.readFileSync(file, 'utf8'), corrupt);}
  const preserved = fs.readdirSync(folder).filter((name) => name.startsWith('records.json.corrupt-'));
  assert.equal(preserved.length, 1); assert.equal(copies, 1);
  assert.equal(fs.readFileSync(join(folder, preserved[0]), 'utf8'), corrupt);
  assert.equal(countAt(file + '.bak.1'), 1);
  assert.equal(fs.existsSync(file + '.bak.2'), false);
  assert.equal(fs.existsSync(file + '.tmp'), false);
});

test('persistent commit denial retains corrupt bytes and the recovered cache with one sidecar', (t) => {
  const {folder, file} = fixture(t, 2); const corrupt = '{original corrupt bytes'; fs.writeFileSync(file, corrupt);
  const errors = []; let copies = 0;
  const store = new JsonStore(file, {validate, fs: {
    copyFileSync: (...args) => {copies++; return fs.copyFileSync(...args);},
    renameSync: (...args) => {
      if (args[0] === file + '.tmp') {const error = denied(errors.length + 1); errors.push(error); throw error;}
      return fs.renameSync(...args);
    },
  }});
  assert.deepEqual(store.load(), {count: 1});
  assert.throws(() => store.save({count: 10}), (error) => error === errors.at(-1));
  assert.equal(errors.length, windows ? 4 : 1); assert.equal(copies, 1);
  assert.equal(store._cache.count, 1); assert.equal(fs.readFileSync(file, 'utf8'), corrupt);
  const preserved = fs.readdirSync(folder).filter((name) => name.startsWith('records.json.corrupt-'));
  assert.equal(preserved.length, 1); assert.equal(fs.readFileSync(join(folder, preserved[0]), 'utf8'), corrupt);
  assert.equal(countAt(file + '.bak.1'), 1); assert.equal(fs.existsSync(file + '.bak.2'), false);
  assert.equal(fs.existsSync(file + '.tmp'), false);
  assert.deepEqual(new JsonStore(file, {validate}).load(), {count: 1});
});

test('an unrelated backup rename denial retains the existing warning policy without retries', (t) => {
  const {file} = fixture(t); let backupAttempts = 0, commitAttempts = 0;
  const store = new JsonStore(file, {validate, fs: {renameSync: (...args) => {
    if (args[0] === file + '.tmp') {commitAttempts++; return fs.renameSync(...args);}
    backupAttempts++; throw denied(backupAttempts);
  }}});
  assert.deepEqual(store.save({count: 5}), {count: 5});
  assert.equal(backupAttempts, 1); assert.equal(commitAttempts, 1);
  assert.match(store.warnings.join('\n'), /백업 생성에 실패/);
});

test('failed corrupt preservation never enters the commit retry', (t) => {
  const {file} = fixture(t, 2); fs.writeFileSync(file, '{bad'); let copies = 0, commits = 0;
  const store = new JsonStore(file, {validate, fs: {
    copyFileSync: () => {copies++; throw denied(1);},
    renameSync: (...args) => {commits++; return fs.renameSync(...args);},
  }});
  store.load(); assert.throws(() => store.save({count: 3}), /보존에 실패/);
  assert.equal(copies, 1); assert.equal(commits, 0);
  assert.equal(fs.readFileSync(file, 'utf8'), '{bad');
  assert.equal(fs.existsSync(file + '.tmp'), false);
});

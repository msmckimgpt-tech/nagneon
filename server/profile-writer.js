import {
  mkdirSync,
  realpathSync,
  readFileSync,
  writeFileSync,
  existsSync,
  unlinkSync,
  rmdirSync,
  renameSync,
  copyFileSync,
  openSync,
  fsyncSync,
  closeSync,
} from 'node:fs';
import { resolve } from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { JsonStore } from './storage.js';
export function ownProfileWriter(dataDir) {
  mkdirSync(dataDir, { recursive: true });
  const root = realpathSync(dataDir),
    lock = resolve(root, '.nagneon-writer'),
    owner = JSON.stringify({ pid: process.pid, nonce: randomUUID(), at: new Date().toISOString() });
  try {
    mkdirSync(lock);
  } catch (error) {
    if (error.code !== 'EEXIST') throw error;
    const recovery = resolve(root, '.nagneon-writer-recovery');
    try {
      mkdirSync(recovery);
    } catch {
      throw Error('프로필 잠금을 확인 중입니다. 잠시 뒤 다시 실행하세요.');
    }
    try {
      const recorded = readFileSync(resolve(lock, 'owner.json'), 'utf8');
      const prior = JSON.parse(recorded);
      if (!Number.isInteger(prior.pid) || prior.pid <= 0 || !/^[a-f0-9-]{36}$/.test(prior.nonce))
        throw Error('프로필 잠금 기록을 확인하세요.');
      let absent = false;
      try {
        process.kill(prior.pid, 0);
      } catch (e) {
        if (e.code === 'ESRCH') absent = true;
        else throw e;
      }
      if (!absent)
        throw Error('이 프로필을 다른 실행이 사용 중입니다. 기존 실행을 정상 종료하세요.');
      if (readFileSync(resolve(lock, 'owner.json'), 'utf8') !== recorded)
        throw Error('프로필 잠금 소유권이 바뀌었습니다.');
      // Preserve the dead owner's exact record; never terminate or steal from a live PID.
      renameSync(lock, resolve(root, '.nagneon-writer-exited-' + prior.nonce));
      mkdirSync(lock);
    } finally {
      rmdirSync(recovery);
    }
  }
  try {
    writeFileSync(resolve(lock, 'owner.json'), owner, { flag: 'wx' });
  } catch (e) {
    rmdirSync(lock);
    throw e;
  }
  let released = false;
  const release = () => {
    if (released) return;
    if (!existsSync(lock)) {
      released = true;
      process.removeListener('exit', onExit);
      return;
    }
    if (readFileSync(resolve(lock, 'owner.json'), 'utf8') !== owner)
      throw Error('프로필 잠금 소유권이 바뀌었습니다.');
    unlinkSync(resolve(lock, 'owner.json'));
    rmdirSync(lock);
    released = true;
    process.removeListener('exit', onExit);
  };
  const onExit = () => {
    try {
      release();
    } catch {}
  };
  process.once('exit', onExit);
  return release;
}
export function inspectWorldFormat(dataDir) {
  const marker = resolve(dataDir, 'profile-format.json'),
    file = resolve(dataDir, 'world.json');
  if (existsSync(marker)) {
    const m = JSON.parse(readFileSync(marker, 'utf8'));
    if (m.minReader !== 2)
      throw Error('이 프로필은 다른 버전의 앱이 필요합니다. 기존 기록을 보존하세요.');
    if (!existsSync(file))
      throw Error('사회 기록의 기본 저장 파일이 없습니다. 백업을 자동 복원하지 않습니다.');
  }
  let version = 0;
  if (existsSync(file)) {
    try {
      version = JSON.parse(readFileSync(file, 'utf8')).version;
    } catch {
      if (existsSync(marker))
        throw Error('사회 기록이 손상되어 자동 복구를 중단했습니다. 원본과 백업을 보존하세요.');
    }
  }
  if (version > 2)
    throw Error('더 새로운 앱에서 저장한 프로필입니다. 현재 앱으로 변경할 수 없습니다.');
  return { protected: existsSync(marker) || version === 2, migrate: version !== 2 };
}
export function markWorldFormat(dataDir) {
  const store = new JsonStore(resolve(dataDir, 'profile-format.json'), {
    validate: (v) => {
      if (v.minReader !== 2 || v.minAppVersion !== '0.1.7')
        throw Error('프로필 형식 표시를 확인하세요.');
      return v;
    },
    initial: () => ({ minReader: 2, minAppVersion: '0.1.7' }),
  });
  store.save({ minReader: 2, minAppVersion: '0.1.7' });
}

export function backupWorldV1(dataDir, { copy = copyFileSync } = {}) {
  const file = resolve(dataDir, 'world.json');
  if (!existsSync(file)) return null;
  const bytes = readFileSync(file);
  if (JSON.parse(bytes.toString('utf8')).version !== 1) return null;
  const hash = (value) => createHash('sha256').update(value).digest('hex');
  const expected = hash(bytes),
    dir = resolve(dataDir, 'migration-backups');
  mkdirSync(dir, { recursive: true });
  const target = resolve(dir, 'world-v1-' + expected + '.json');
  if (!existsSync(target)) copy(file, target, 1);
  if (hash(readFileSync(target)) !== expected || hash(readFileSync(file)) !== expected)
    throw Error('이전 형식의 백업을 검증하지 못해 변환을 중단했습니다.');
  const fd = openSync(target, 'r+');
  try {
    fsyncSync(fd);
  } finally {
    closeSync(fd);
  }
  return { file: target, sha256: expected };
}

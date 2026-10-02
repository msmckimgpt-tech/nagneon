import { existsSync, readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { JsonStore } from './storage.js';

export const WORLD_PROFILE_FORMAT = Object.freeze({ minReader: 2, minAppVersion: '0.1.7' });
export const UNLIMITED_READERS_FORMAT = Object.freeze({ minReader: 3, minAppVersion: '0.1.18' });
export const TREND_FACTS_FORMAT = Object.freeze({ minReader: 4, minAppVersion: '0.1.18' });
// Reader 4 was already used by the sourced-community preview. Its journal
// cannot load long originals, so those require a distinct, cumulative reader.
export const LONG_SPEECH_FORMAT = Object.freeze({ minReader: 5, minAppVersion: '0.1.18' });
export const PROFILE_READER = 5;
const appVersion = JSON.parse(
  readFileSync(new URL('../package.json', import.meta.url), 'utf8'),
).version;
const versionParts = (version) => {
  if (typeof version !== 'string' || !/^\d+\.\d+\.\d+$/.test(version))
    throw Error('프로필의 최소 앱 버전을 확인하세요. 원본과 백업을 보존하세요.');
  const parts = version.split('.').map(Number);
  if (!parts.every(Number.isSafeInteger)) throw Error('프로필의 최소 앱 버전을 확인하세요.');
  return parts;
};
const compareVersions = (a, b) => {
  const left = versionParts(a),
    right = versionParts(b);
  for (let i = 0; i < 3; i++) if (left[i] !== right[i]) return left[i] - right[i];
  return 0;
};
export function validateProfileFormat(value) {
  if (
    !value ||
    typeof value !== 'object' ||
    Array.isArray(value) ||
    !Number.isSafeInteger(value.minReader) ||
    value.minReader < 2
  )
    throw Error('프로필 형식 표시를 확인하세요. 원본과 백업을 보존하세요.');
  versionParts(value.minAppVersion);
  return value;
}
export function readProfileFormat(dataDir) {
  const file = resolve(dataDir, 'profile-format.json');
  if (!existsSync(file)) return null;
  let value;
  try {
    value = JSON.parse(readFileSync(file, 'utf8'));
  } catch (error) {
    throw Error('프로필 형식 표시를 읽을 수 없습니다. 원본과 백업을 보존하세요.', { cause: error });
  }
  return validateProfileFormat(value);
}
export function assertSupportedProfileFormat(format) {
  if (!format) return;
  if (format.minReader > PROFILE_READER || compareVersions(appVersion, format.minAppVersion) < 0)
    throw Error('이 프로필은 다른 버전의 앱이 필요합니다. 기존 기록을 보존하세요.');
}
export function mergeProfileFormat(previous, required = WORLD_PROFILE_FORMAT) {
  validateProfileFormat(required);
  if (!previous) return { ...required };
  validateProfileFormat(previous);
  return {
    ...previous,
    minReader: Math.max(previous.minReader, required.minReader),
    minAppVersion:
      compareVersions(previous.minAppVersion, required.minAppVersion) < 0
        ? required.minAppVersion
        : previous.minAppVersion,
  };
}
export function writeProfileFormat(dataDir, required = WORLD_PROFILE_FORMAT) {
  const previous = readProfileFormat(dataDir);
  assertSupportedProfileFormat(previous);
  const next = mergeProfileFormat(previous, required);
  assertSupportedProfileFormat(next);
  if (previous && JSON.stringify(previous) === JSON.stringify(next)) return next;
  const store = new JsonStore(resolve(dataDir, 'profile-format.json'), {
    validate: validateProfileFormat,
    initial: () => WORLD_PROFILE_FORMAT,
    forbidRecovery: true,
  });
  store.save(next);
  return next;
}

// Viewer counts are durable history, unlike bounded request windows or retry queues.
// Only representations that the previous reader cannot load raise the profile floor.
export function requiredProfileFormat(name, value) {
  if (name === 'journal')
    return value.entries.some((entry) => entry.text.length > 3000) ? LONG_SPEECH_FORMAT : null;
  if (name === 'world' && value.socialWorld?.threads?.some((thread) => thread.trendFact))
    return TREND_FACTS_FORMAT;
  const expanded =
    name === 'clips'
      ? value.some((c) => [c.readings, c.votes, c.activityReads].some((rows) => rows?.length > 150))
      : name === 'world' && value.audience.posts.some((p) => p.activityReads?.length > 150);
  return expanded ? UNLIMITED_READERS_FORMAT : null;
}

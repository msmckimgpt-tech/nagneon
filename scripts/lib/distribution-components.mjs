import { createHash } from 'node:crypto';

const definitions = [
  { id: 'app', label: '기본 앱', requires: [] },
  { id: 'audio', label: '공통 음성 런타임', requires: ['app'] },
  { id: 'sound', label: '시스템 소리 인식 모델', requires: ['audio'] },
  { id: 'microphone', label: '마이크 인식 모델', requires: ['audio'] },
  { id: 'gpu', label: 'GPU 가속', requires: ['audio'] },
];

export function componentForPath(path) {
  if (path.startsWith('resources/speech/gpu/')) return 'gpu';
  if (path.startsWith('resources/speech/microphone-model/')) return 'microphone';
  if (/^resources\/speech\/(python|licenses)\//.test(path)) return 'audio';
  if (path.startsWith('resources/speech/model/') || /^resources\/sound\/(model\/|NOTICE\.txt$|provenance\.json$)/.test(path)) return 'sound';
  return 'app';
}

// Content identity is independent of app version and build time, allowing
// unchanged runtime downloads to be reused after their files are verified.
export function distributionComponents(inventory) {
  const seen = new Set();
  const groups = new Map(definitions.map(d => [d.id, []]));
  for (const file of inventory) {
    if (typeof file.path !== 'string' || !file.path || /[\\:\x00-\x1f]/.test(file.path) || file.path.split('/').some(p => !p || p === '.' || p === '..')) throw Error('Invalid distribution path');
    const key = file.path.toLowerCase();
    if (seen.has(key)) throw Error('Duplicate distribution path');
    seen.add(key);
    if (!Number.isSafeInteger(file.bytes) || file.bytes < 0 || !/^[a-f0-9]{64}$/i.test(file.sha256)) throw Error('Invalid distribution file integrity');
    groups.get(componentForPath(file.path)).push({ path: file.path, bytes: file.bytes, sha256: file.sha256.toLowerCase() });
  }
  return definitions.map(definition => {
    const files = groups.get(definition.id).sort((a, b) => a.path < b.path ? -1 : a.path > b.path ? 1 : 0);
    return { ...definition, contentId: createHash('sha256').update(JSON.stringify(files)).digest('hex'), bytes: files.reduce((n, f) => n + f.bytes, 0), files };
  });
}

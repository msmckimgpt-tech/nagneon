import { cp, mkdir, lstat, writeFile } from 'node:fs/promises';
import { join, dirname } from 'node:path';
import { validateRuntimeComponent } from '../../server/runtime-pack.js';
import { componentForPath } from './distribution-components.mjs';

export function packageLayout(args) {
  const bundled = args.includes('--bundled');
  if (bundled && args.includes('--components')) throw Error('--bundled와 --components는 함께 사용할 수 없습니다.');
  const speech = args.find(arg => arg.startsWith('--speech='))?.slice(9);
  if (bundled && !speech) throw Error('전체 동봉 빌드는 --speech=<검증된 음성 런타임 폴더>가 필요합니다.');
  return { modular: !bundled, speech };
}

const requiredFiles = {
  audio: ['resources/speech/python/python.exe'],
  sound: ['resources/sound/model/yamnet.onnx', 'resources/speech/model/model.bin'],
  microphone: ['resources/speech/microphone-model/model.bin'],
  gpu: ['resources/speech/gpu/nvidia/cublas/bin/cublas64_12.dll', 'resources/speech/gpu/nvidia/cudnn/bin/cudnn64_9.dll'],
};

// Validate the pinned catalog without copying or downloading its payloads.
// Runtime installation still verifies the archive and every extracted file.
export function validatePackageCatalog(catalog) {
  if (catalog?.format !== 'nagneon-runtime-catalog/1' || !Array.isArray(catalog.components)) throw Error('실행 구성 목록 형식이 다릅니다.');
  const seen = new Set();
  for (const component of catalog.components) {
    validateRuntimeComponent(component);
    if (seen.has(component.id)) throw Error('중복 실행 구성입니다.');
    seen.add(component.id);
    if (component.files.some(file => componentForPath(file.path) !== component.id)) throw Error('실행 구성 파일 분류가 다릅니다.');
    if (requiredFiles[component.id].some(path => !component.files.some(file => file.path === path && file.bytes > 0))) throw Error('필수 실행 구성 파일이 없습니다: ' + component.id);
    const archive = component.archive;
    if (archive?.format !== 'nagneon-runtime-gzip/1' || !Number.isSafeInteger(archive.bytes) || archive.bytes <= 0 || !/^[a-f0-9]{64}$/.test(archive.sha256)) throw Error('실행 구성 압축 무결성 정보가 없습니다.');
    const url = new URL(archive.url);
    if (url.protocol !== 'https:' || url.username || url.password || url.hash) throw Error('실행 구성 주소는 인증 정보 없는 HTTPS여야 합니다.');
  }
  if (Object.keys(requiredFiles).some(id => !seen.has(id))) throw Error('실행 구성 목록이 불완전합니다.');
  return catalog;
}

const workers = {
  'scripts/speech_worker.py': 'speech/speech_worker.py',
  'scripts/clip_inspector.py': 'speech/clip_inspector.py',
  'scripts/clip_perception.py': 'speech/clip_perception.py',
  'scripts/sound_worker.py': 'sound/sound_worker.py',
};

export async function stageComponentRuntime(root, target, catalog) {
  validatePackageCatalog(catalog);
  for (const [source, destination] of Object.entries(workers)) {
    const path = join(root, source), stat = await lstat(path);
    if (!stat.isFile() || stat.isSymbolicLink()) throw Error('실행 스크립트가 일반 파일이 아닙니다: ' + source);
    const output = join(target, destination);
    await mkdir(dirname(output), { recursive: true });
    await cp(path, output, { errorOnExist: true, force: false });
  }
  const marker = join(target, 'runtime-components.json');
  await writeFile(marker, JSON.stringify({ schema: 'nagneon-runtime-layout/1', mode: 'components' }), { flag: 'wx' });
  return [join(target, 'speech'), join(target, 'sound'), marker];
}

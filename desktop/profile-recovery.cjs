const fs = require('node:fs');
const path = require('node:path');
const { randomUUID } = require('node:crypto');
const storage = require('./storage.cjs');

function requestProfile(appData, explicitProfile) {
  if (explicitProfile) return { profile: explicitProfile, explicit: true, registered: false };
  const { defaultProfile, configFile } = storage.storagePaths(appData);
  if (!fs.existsSync(configFile)) return { profile: defaultProfile, registered: false };
  try {
    const saved = JSON.parse(fs.readFileSync(configFile, 'utf8').replace(/^\uFEFF/, ''));
    if (typeof saved.profile !== 'string' || !path.isAbsolute(saved.profile)) throw Error('invalid');
    return { profile: saved.profile, registered: true };
  } catch {
    return { profile: defaultProfile, registered: true, issue: '저장 위치 설정을 읽지 못했습니다. 기존 기록 폴더를 선택하면 복구 후 계속 실행합니다.' };
  }
}

function redirectedCandidates(profile, appData, packages) {
  const relative = path.relative(appData, profile);
  if (!relative || relative.startsWith('..') || path.isAbsolute(relative)) return [];
  if (!fs.existsSync(packages)) return [];
  return fs.readdirSync(packages, { withFileTypes: true }).filter(e => e.isDirectory() && !e.isSymbolicLink())
    .map(e => path.join(packages, e.name, 'LocalCache', 'Roaming', relative, 'data'))
    .filter(p => fs.existsSync(path.join(p, 'world.json')));
}

function restoreRecords(source, profile) {
  const target = path.join(profile, 'data');
  if (fs.existsSync(target)) throw Error('현재 기록 폴더는 덮어쓰지 않습니다. 다른 저장 위치를 선택해주세요.');
  for (let p = path.resolve(source); ; p = path.dirname(p)) {
    if (fs.lstatSync(p).isSymbolicLink()) throw Error('링크가 아닌 원본 기록 폴더를 선택해주세요.');
    if (path.dirname(p) === p) break;
  }
  const world = JSON.parse(fs.readFileSync(path.join(source, 'world.json'), 'utf8').replace(/^\uFEFF/, ''));
  if (!world || typeof world !== 'object' || Array.isArray(world)) throw Error('선택한 폴더의 기록 형식을 확인해주세요.');
  const before = storage.inventory(source);
  fs.mkdirSync(profile, { recursive: true });
  const stage = path.join(profile, 'data.recovery-' + randomUUID());
  fs.cpSync(source, stage, { recursive: true, errorOnExist: true, force: false });
  if (JSON.stringify(before) !== JSON.stringify(storage.inventory(stage)) || JSON.stringify(before) !== JSON.stringify(storage.inventory(source))) {
    throw Error('복사 중 기록이 변경되었습니다. 다른 나그네온을 종료한 뒤 다시 시도하세요. 원본은 보존했습니다.');
  }
  if (fs.existsSync(target)) throw Error('다른 실행에서 기록 폴더를 생성했습니다. 다시 실행해주세요.');
  fs.renameSync(stage, target);
  return { files: before.length };
}

function saveRecoveredSetting(appData, profile) {
  const { configFile } = storage.storagePaths(appData);
  fs.mkdirSync(path.dirname(configFile), { recursive: true });
  if (fs.existsSync(configFile)) fs.copyFileSync(configFile, configFile + '.before-recovery-' + randomUUID(), fs.constants.COPYFILE_EXCL);
  const temp = configFile + '.' + randomUUID() + '.tmp';
  fs.writeFileSync(temp, JSON.stringify({ profile, recoveredAt: new Date().toISOString() }), { flag: 'wx' });
  fs.renameSync(temp, configFile);
}

async function prepareProfile({ appData, explicitProfile, dialog, packages = path.join(appData, '..', 'Local', 'Packages') }) {
  const request = requestProfile(appData, explicitProfile);
  const profile = request.profile;
  if (!request.issue && fs.existsSync(path.join(profile, 'data'))) return { profile, recovered: false };
  let issue = request.issue;
  let attemptedAutomatic = false;
  while (true) {
    let candidates = [];
    try { candidates = redirectedCandidates(profile, appData, packages); }
    catch { issue = '기존 기록을 자동으로 찾지 못했습니다. 기록 폴더를 직접 선택해주세요.'; }
    if (!issue && !request.registered && candidates.length === 0) return { profile, recovered: false, firstRun: true };
    let source, selected = false;
    if (!issue && !attemptedAutomatic && candidates.length === 1) {
      source = candidates[0]; attemptedAutomatic = true;
    } else {
      const answer = await dialog.showMessageBox({ type: 'info', title: '기존 기록으로 계속하기',
        message: issue || '사용하던 기록을 찾아 방송실을 열겠습니다.',
        detail: `저장 위치: ${profile}\n${candidates.length ? '발견한 기록: ' + candidates.join('\n') : '기록이 있는 저장 장치를 연결하거나 기존 프로필 폴더를 선택하세요.'}\n원본은 보존하며 빈 기록으로 초기화하지 않습니다.`,
        buttons: ['기록 폴더 선택', '다시 찾기', '종료'], defaultId: 0, cancelId: 2 });
      if (answer.response === 2) return null;
      if (answer.response === 1) { issue = request.issue; attemptedAutomatic = false; continue; }
      const chosen = await dialog.showOpenDialog({ title: '기존 나그네온 프로필 또는 data 폴더', properties: ['openDirectory'], defaultPath: candidates[0] });
      if (chosen.canceled) continue;
      source = chosen.filePaths[0];
      if (fs.existsSync(path.join(source, 'data'))) source = path.join(source, 'data');
      selected = true;
    }
    try {
      // A broken registry may point to a default profile that already contains
      // records. Selecting that same profile reconnects it without copying.
      let activeProfile = profile, result;
      if (selected) {
        if (path.basename(source).toLowerCase() !== 'data') throw Error('프로필 폴더 또는 그 안의 data 폴더를 선택해주세요.');
        const world = JSON.parse(fs.readFileSync(path.join(source, 'world.json'), 'utf8').replace(/^\uFEFF/, ''));
        if (!world || typeof world !== 'object' || Array.isArray(world)) throw Error('선택한 기록 형식을 확인해주세요.');
        activeProfile = path.dirname(source);
        result = { files: storage.inventory(source).length };
        if (!request.explicit) saveRecoveredSetting(appData, activeProfile);
      } else result = restoreRecords(source, profile);
      try {
        fs.mkdirSync(path.join(activeProfile, 'logs'), { recursive: true });
        fs.appendFileSync(path.join(activeProfile, 'logs', 'profile-recovery.jsonl'), JSON.stringify({ at: new Date().toISOString(), event: 'profile-recovered', files: result.files }) + '\n');
      } catch { /* Diagnostic failure must not undo a verified recovery. */ }
      return { profile: activeProfile, recovered: true, ...result };
    } catch (error) { issue = '기록 복구를 완료하지 못했습니다. ' + error.message; }
  }
}
module.exports = { requestProfile, redirectedCandidates, restoreRecords, prepareProfile };

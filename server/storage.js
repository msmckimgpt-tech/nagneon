import { existsSync, readFileSync, readdirSync, writeSync, renameSync, mkdirSync, unlinkSync, copyFileSync, openSync, fsyncSync, closeSync } from 'node:fs';
import { resolve, dirname, basename } from 'node:path';

// 기본 파일시스템 어댑터. 테스트에서 특정 메서드만 교체해 실패를 재현할 수 있도록
// 생성자 옵션 fs 로 부분 덮어쓰기가 가능하다.
const nodeFs = { existsSync, readFileSync, readdirSync, writeSync, renameSync, mkdirSync, unlinkSync, copyFileSync, openSync, fsyncSync, closeSync };
const escapeRegExp = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 로컬 JSON 저장을 위한 견고한 building block.
// - 저장은 임시 파일 → fsync → rename 으로 원자적으로 커밋한다.
// - 손상된 기본 파일은 같은 store 의 최신 유효 백업으로 복구하고 명시적으로 보고한다.
// - 복구가 불가능하면 절대 조용히 덮어쓰거나 초기화하지 않고 오류를 던진다.
// - 백업은 store 이름에 정확히 종속된 경로만 다루며, 개수 상한을 지킨다.
export class JsonStore {
  constructor(file, { validate, initial = () => ({}), backupCount = 3, fs = {}, forbidRecovery = false } = {}) {
    if (typeof file !== 'string' || !file.trim()) throw new Error('JsonStore: 저장 파일 경로가 필요합니다.');
    if (typeof validate !== 'function') throw new Error('JsonStore: validate 함수가 필요합니다.');
    if (typeof initial !== 'function') throw new Error('JsonStore: initial 은 함수여야 합니다.');
    if (!Number.isInteger(backupCount) || backupCount < 0) throw new Error('JsonStore: backupCount 는 0 이상의 정수여야 합니다.');
    this.forbidRecovery = forbidRecovery;
    this.file = resolve(file);
    this.dir = dirname(this.file);
    this.backupCount = backupCount;
    this._base = basename(this.file);
    this._validate = validate;
    this._initial = initial;
    this._tmp = this.file + '.tmp';
    this._backupRe = new RegExp('^' + escapeRegExp(this._base) + '\\.bak\\.(\\d+)$');
    this.fs = { ...nodeFs, ...fs };
    this._cache = null;            // 마지막으로 검증된 데이터(내부 캐시)
    this._preserveCorrupt = false; // load 가 손상 기본 파일을 감지하면 다음 save 에서 보존
    this.warnings = [];
    this.recoveredFrom = null;
  }

  // 검증된 데이터를 반환한다. 기본 파일이 없고 백업도 전혀 없었다면 initial() 을 검증해 반환.
  // 기본 파일이 손상되면 같은 store 의 최신 유효 백업으로 복구하고 recoveredFrom/warnings 에 보고.
  // 복구할 유효 데이터가 전혀 없으면 오류를 던진다(초기화/덮어쓰기 금지).
  load() {
    this.warnings = [];
    this.recoveredFrom = null;
    this._preserveCorrupt = false;
    const primaryRaw = this._read(this.file);
    let primaryError = null;
    if (primaryRaw !== null) {
      const parsed = this._parse(primaryRaw);
      if (parsed.ok) { this._cache = parsed.value; return structuredClone(parsed.value); }
      primaryError = parsed.error;
    }
    if (this.forbidRecovery) throw new Error('기본 저장 파일을 자동 복구할 수 없습니다. 삭제 기록 보존을 위해 원본과 백업을 확인하세요.');
    const backups = this._ownBackups(); // n=1 이 최신
    for (const b of backups) {
      let raw;
      try { raw = this.fs.readFileSync(b.path, 'utf8'); }
      catch (e) { if (!(e && e.code === 'ENOENT')) this.warnings.push(`백업을 읽을 수 없어 건너뜁니다: ${b.path} (${e.message})`); continue; }
      const parsed = this._parse(raw);
      if (parsed.ok) {
        this._cache = parsed.value;
        this.recoveredFrom = b.path;
        if (primaryRaw === null) this.warnings.push(`기본 저장 파일이 없어 백업에서 복구했습니다: ${b.path}`);
        else { this.warnings.push(`기본 저장 파일이 손상되어 백업에서 복구했습니다: ${b.path}`); this._preserveCorrupt = true; }
        return structuredClone(parsed.value);
      }
      this.warnings.push(`백업이 손상되어 건너뜁니다: ${b.path}`);
    }
    if (primaryRaw === null && backups.length === 0) {
      let init;
      try { init = this._validate(this._initial()); }
      catch (e) { throw new Error('초기 데이터가 유효하지 않습니다: ' + e.message); }
      if (init === undefined) throw new Error('initial 데이터에 대한 validate 결과가 없습니다.');
      this._cache = init;
      return structuredClone(init);
    }
    if (primaryRaw !== null) throw new Error(`기본 저장 파일이 손상되었고 사용할 수 있는 백업이 없습니다: ${this.file} — ${primaryError.message}`);
    throw new Error(`기본 저장 파일이 없고 백업도 모두 손상되어 복구할 수 없습니다: ${this.file}`);
  }

  // value 를 검증 후 원자적으로 저장한다. 검증 실패 시 디스크를 전혀 건드리지 않고 던진다.
  // 이전에 손상으로 복구했다면 손상 원본을 보존한 뒤 새 데이터를 커밋한다.
  save(value) {
    const validated = this._validate(structuredClone(value)); // 사본을 검증해 호출자 변형을 격리
    if (validated === undefined) throw new Error('validate 함수가 검증된 데이터를 반환하지 않았습니다.');
    const json = JSON.stringify(validated, null, 2);
    this._ensureDir();
    this._writeTemp(json); // 여기서 실패하면 기본 파일은 그대로 유지된다.
    try {
      if (this._preserveCorrupt) this._preserve();
      else if (this.fs.existsSync(this.file)) {
        if (this._primaryIsValid()) { if (this.backupCount > 0) this._backupCurrent(); }
        else this._preserve(); // load 없이 저장했거나 외부 변조된 손상 원본도 보존, 백업 오염 방지
      }
      this.fs.renameSync(this._tmp, this.file); // 원자적 커밋
    } catch (e) {
      this._safeUnlink(this._tmp);
      throw e;
    }
    this._syncDir();
    this._cache = validated;
    this._preserveCorrupt = false;
    return structuredClone(validated);
  }

  _bakPath(n) { return this.file + '.bak.' + n; }

  _read(path) {
    try { return this.fs.readFileSync(path, 'utf8'); }
    catch (e) { if (e && e.code === 'ENOENT') return null; throw new Error(`저장 파일을 읽을 수 없습니다: ${path} (${e.message})`); }
  }

  _parse(raw) {
    let data;
    try { data = JSON.parse(raw); }
    catch (e) { return { ok: false, error: new Error('JSON 형식이 아닙니다: ' + e.message) }; }
    try {
      const value = this._validate(data);
      if (value === undefined) return { ok: false, error: new Error('validate 함수가 검증된 데이터를 반환하지 않았습니다.') };
      return { ok: true, value };
    } catch (e) { return { ok: false, error: e }; }
  }

  _primaryIsValid() {
    const raw = this._read(this.file);
    return raw !== null && this._parse(raw).ok;
  }

  // this.dir 안에서 이 store 의 이름에 정확히 일치하는 백업만 수집한다. n=1 이 최신.
  _ownBackups() {
    let names;
    try { names = this.fs.readdirSync(this.dir); }
    catch { return []; }
    return names
      .map((name) => { const m = this._backupRe.exec(name); return m ? { n: Number(m[1]), path: resolve(this.dir, name) } : null; })
      .filter(Boolean)
      .sort((a, b) => a.n - b.n);
  }

  _ensureDir() {
    try { this.fs.mkdirSync(this.dir, { recursive: true }); }
    catch (e) { throw new Error(`저장 폴더를 만들 수 없습니다: ${this.dir} (${e.message})`); }
  }

  _writeTemp(json) {
    let fd;
    try {
      fd = this.fs.openSync(this._tmp, 'w');
      const bytes=Buffer.from(json,'utf8');let offset=0;
      while(offset<bytes.length){const written=this.fs.writeSync(fd,bytes,offset,bytes.length-offset,null);if(!Number.isInteger(written)||written<=0||written>bytes.length-offset)throw new Error('파일 쓰기가 끝까지 진행되지 않았습니다.');offset+=written;}
      this.fs.fsyncSync(fd);
    } catch (e) {
      if (fd !== undefined) this._safeClose(fd);
      this._safeUnlink(this._tmp);
      throw new Error(`임시 파일 기록에 실패했습니다: ${this._tmp} (${e.message})`);
    }
    this._safeClose(fd);
  }

  // 현재(유효한) 기본 파일을 세대별 백업으로 회전 저장한다. 상한 초과분은 정리. 백업 실패는 비치명적.
  _backupCurrent() {
    try {
      const n = this.backupCount;
      if (this.fs.existsSync(this._bakPath(n))) this.fs.unlinkSync(this._bakPath(n));
      for (let k = n - 1; k >= 1; k--) if (this.fs.existsSync(this._bakPath(k))) this.fs.renameSync(this._bakPath(k), this._bakPath(k + 1));
      this.fs.copyFileSync(this.file, this._bakPath(1));
      for (const b of this._ownBackups()) if (b.n > n) this._safeUnlink(b.path); // 상한이 줄었을 때의 잔여 백업 정리
    } catch (e) { this.warnings.push(`백업 생성에 실패했습니다: ${e.message}`); }
  }

  // 손상된 기본 파일을 덮어쓰기 전에 별도 사이드카로 보존한다. 실패 시 저장을 중단(치명적).
  _preserve() {
    let target = this.file + '.corrupt-' + Date.now();
    while (this.fs.existsSync(target)) target += '~';
    try { this.fs.copyFileSync(this.file, target); }
    catch (e) { throw new Error(`손상된 기본 저장 파일 보존에 실패하여 저장을 중단했습니다: ${e.message}`); }
    this.warnings.push(`손상된 기본 저장 파일을 보존했습니다: ${target}`);
    this._preserveCorrupt = false;
  }

  _syncDir() {
    let fd;
    try { fd = this.fs.openSync(this.dir, 'r'); this.fs.fsyncSync(fd); }
    catch { /* 일부 플랫폼(Windows 등)은 디렉터리 fsync 를 지원하지 않음 — 무시 */ }
    finally { if (fd !== undefined) this._safeClose(fd); }
  }

  _safeUnlink(p) { try { if (this.fs.existsSync(p)) this.fs.unlinkSync(p); } catch { /* best-effort */ } }
  _safeClose(fd) { try { this.fs.closeSync(fd); } catch { /* best-effort */ } }
}

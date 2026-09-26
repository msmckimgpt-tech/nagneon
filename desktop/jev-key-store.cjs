const fs = require('node:fs');
const { dirname, isAbsolute } = require('node:path');
const { randomUUID } = require('node:crypto');

const SAVE_ERROR = 'JEV 키를 안전하게 저장하지 못했습니다. 저장 공간과 보안 저장소를 확인하세요.';
const REMOVE_ERROR = 'JEV 키를 안전하게 제거하지 못했습니다. 저장 공간과 권한을 확인하세요.';
const RESTORE_ERROR = '저장된 JEV 키를 복원하지 못했습니다. 키를 다시 연결하세요.';
const SESSION_ERROR = '보안 저장소를 사용할 수 없어 JEV 키는 이번 실행에만 유지됩니다.';
const PROVIDERS = new Set(['typesafe', 'openrouter']);

class JevKeyStore {
  constructor({ file, safeStorage, platform = process.platform }) {
    if (!isAbsolute(file)) throw new TypeError('JEV 키 저장 경로는 절대 경로여야 합니다.');
    this.file = file;
    this.safeStorage = safeStorage;
    this.platform = platform;
  }

  available() {
    try {
      return (
        this.safeStorage?.isEncryptionAvailable() === true &&
        (this.platform !== 'linux' ||
          ['gnome_libsecret', 'kwallet', 'kwallet5', 'kwallet6'].includes(
            this.safeStorage.getSelectedStorageBackend(),
          ))
      );
    } catch {
      return false;
    }
  }

  load(provider) {
    let present = false;
    try {
      const info = fs.lstatSync(this.file);
      present = true;
      if (!this.available()) return { key: '', status: 'none', error: RESTORE_ERROR, present };
      if (!info.isFile() || info.nlink !== 1 || info.size < 1 || info.size > 8192)
        throw new Error('invalid encrypted file');
      const value = JSON.parse(this.safeStorage.decryptString(fs.readFileSync(this.file)));
      if (
        value?.version !== 1 ||
        !PROVIDERS.has(value.provider) ||
        typeof value.key !== 'string' ||
        !value.key.trim() ||
        value.key.length > 500 ||
        /[\r\n]/.test(value.key)
      )
        throw new Error('invalid encrypted value');
      if (value.provider !== provider) {
        this.clear();
        return { key: '', status: 'none', error: null, present: false };
      }
      return { key: value.key, status: 'saved', error: null, present };
    } catch (error) {
      if (error?.code === 'ENOENT') return { key: '', status: 'none', error: null, present: false };
      return { key: '', status: 'none', error: RESTORE_ERROR, present };
    }
  }

  save(key, provider) {
    if (!PROVIDERS.has(provider) || typeof key !== 'string' || !key.trim())
      throw new TypeError('JEV 키 형식이 올바르지 않습니다.');
    if (!this.available()) {
      this.clear();
      return { status: 'session', error: SESSION_ERROR };
    }
    let temporary;
    try {
      const dir = dirname(this.file);
      fs.mkdirSync(dir, { recursive: true, mode: 0o700 });
      if (!fs.lstatSync(dir).isDirectory()) throw new Error('invalid storage directory');
      fs.chmodSync(dir, 0o700);
      const ciphertext = this.safeStorage.encryptString(
        JSON.stringify({ version: 1, provider, key }),
      );
      if (!Buffer.isBuffer(ciphertext) || !ciphertext.length || ciphertext.length > 8192)
        throw new Error('invalid ciphertext');
      temporary = `${this.file}.${randomUUID()}.tmp`;
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try {
        fs.writeFileSync(fd, ciphertext);
        fs.fsyncSync(fd);
      } finally {
        fs.closeSync(fd);
      }
      fs.renameSync(temporary, this.file);
      temporary = null;
      return { status: 'saved', error: null };
    } catch {
      if (temporary) {
        try {
          fs.unlinkSync(temporary);
        } catch {}
      }
      throw new Error(SAVE_ERROR);
    }
  }

  clear() {
    try {
      fs.unlinkSync(this.file);
    } catch (error) {
      if (error?.code !== 'ENOENT') throw new Error(REMOVE_ERROR);
    }
  }
}

module.exports = { JevKeyStore };

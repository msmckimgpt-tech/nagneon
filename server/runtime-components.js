import { join, isAbsolute } from 'node:path';
import { lstat, unlink } from 'node:fs/promises';
import {
  installRuntimePack,
  validateRuntimeComponent,
  verifyRuntimeComponent,
  regularAncestors,
} from './runtime-pack.js';
import { downloadRuntimePack } from './runtime-download.js';

const features = {
  microphone: ['audio', 'microphone'],
  sound: ['audio', 'sound'],
  clips: ['audio'],
  perception: ['audio', 'sound', 'microphone'],
};
const labels = {
  audio: '공통 음성 처리',
  sound: '시스템 소리 인식',
  microphone: '한국어 마이크 인식',
  gpu: 'GPU 가속',
};

// 공유 작업은 유지하면서 이 호출자의 대기만 취소한다.
function waitFor(promise, signal) {
  return new Promise((yes, no) => {
    const abort = () => {
      signal.removeEventListener('abort', abort);
      no(signal.reason || Error('준비를 취소했습니다.'));
    };
    signal.addEventListener('abort', abort, { once: true });
    promise.then(
      (value) => {
        signal.removeEventListener('abort', abort);
        yes(value);
      },
      (error) => {
        signal.removeEventListener('abort', abort);
        no(error);
      },
    );
    if (signal.aborted) abort();
  });
}

export class RuntimeComponents {
  constructor({
    catalog,
    cache,
    onChange = () => {},
    download = downloadRuntimePack,
    install = installRuntimePack,
    verify = verifyRuntimeComponent,
  }) {
    if (catalog?.format !== 'nagneon-runtime-catalog/1' || !Array.isArray(catalog.components))
      throw Error('실행 구성 목록을 확인하세요.');
    if (!cache || !isAbsolute(cache)) throw Error('실행 구성 저장 경로를 확인하세요.');
    this.components = new Map();
    this.rows = new Map();
    this.jobs = new Map();
    this.preparations = new Map();
    this.inspectionController = new AbortController();
    this.inspection = null;
    this.cache = cache;
    this.onChange = onChange;
    this.download = download;
    this.install = install;
    this.verify = verify;
    this.closed = false;
    this.lastProgress = 0;
    for (const c of catalog.components) {
      validateRuntimeComponent(c);
      if (this.components.has(c.id)) throw Error('중복 실행 구성입니다.');
      const url = new URL(c.archive?.url);
      if (url.protocol !== 'https:' || url.username || url.password)
        throw Error('실행 구성 주소를 확인하세요.');
      this.components.set(c.id, c);
      this.rows.set(c.id, {
        id: c.id,
        label: labels[c.id],
        status: 'idle',
        downloadedBytes: 0,
        downloadBytes: c.archive.bytes,
        installedBytes: 0,
        installBytes: c.bytes,
        error: '',
      });
    }
    if (Object.keys(labels).some((id) => !this.components.has(id)))
      throw Error('실행 구성 목록이 불완전합니다.');
  }

  snapshot() {
    return {
      preparing: this.preparations.size > 0,
      components: [...this.rows.values()].map((row) => ({ ...row })),
    };
  }

  change(id, patch, progress = false) {
    Object.assign(this.rows.get(id), patch);
    if (!progress || Date.now() - this.lastProgress >= 250) {
      this.lastProgress = Date.now();
      this.onChange();
    }
  }

  path(id) {
    const c = this.components.get(id);
    return join(this.cache, 'installed', id + '-' + c.contentId.slice(0, 32));
  }

  // 버전별 설치 경로가 아닌 기존 contentId 캐시를 읽기만 한다.
  // 한 구성의 손상은 다른 구성의 확인을 막지 않으며, 다운로드/복구는 하지 않는다.
  inspectInstalled() {
    if (this.closed) return Promise.reject(Error('실행 구성 준비가 종료되었습니다.'));
    this.inspection ||= Promise.allSettled(
      [...this.components.keys()].map((id) =>
        this.acquire(id, this.inspectionController.signal, false),
      ),
    ).then(() => this.snapshot());
    return this.inspection;
  }

  prepare(feature, signal = new AbortController().signal, device = 'cpu') {
    if (!features[feature]) return Promise.reject(Error('알 수 없는 실행 기능입니다.'));
    if (this.closed) return Promise.reject(Error('실행 구성 준비가 종료되었습니다.'));
    if (signal.aborted) return Promise.reject(signal.reason || Error('준비를 취소했습니다.'));
    const controller = new AbortController();
    const abort = () => controller.abort(signal.reason);
    signal.addEventListener('abort', abort, { once: true });
    const ids = [
      ...features[feature],
      ...(feature === 'microphone' && device === 'gpu' ? ['gpu'] : []),
    ];
    const operation = Promise.resolve()
      .then(async () => {
        for (const id of ids) {
          controller.signal.throwIfAborted();
          await this.acquire(id, controller.signal);
        }
        controller.signal.throwIfAborted();
        return Object.fromEntries(ids.map((id) => [id, this.path(id)]));
      })
      .finally(() => {
        signal.removeEventListener('abort', abort);
        this.preparations.delete(controller);
        this.onChange();
      });
    this.preparations.set(controller, operation);
    this.onChange();
    return operation;
  }

  async acquire(id, signal, allowInstall = true) {
    if (this.closed) throw Error('실행 구성 준비가 종료되었습니다.');
    signal.throwIfAborted();
    if (this.rows.get(id).status === 'ready') return;
    let job = this.jobs.get(id);
    if (job?.controller.signal.aborted) {
      await waitFor(
        job.promise.catch(() => {}),
        signal,
      );
      return this.acquire(id, signal, allowInstall);
    }
    // 설치 중 시작된 조회는 설치의 소비자로 등록하지 않는다.
    // 마지막 실제 사용자가 취소하면 조회 때문에 다운로드가 살아남지 않아야 한다.
    if (!allowInstall && job?.allowInstall) return waitFor(job.promise, signal);
    if (!job) {
      job = { controller: new AbortController(), users: 0, promise: null, allowInstall };
      this.jobs.set(id, job);
      job.promise = Promise.resolve()
        .then(() => this.run(id, job.controller.signal, allowInstall))
        .finally(() => {
          if (this.jobs.get(id) === job) this.jobs.delete(id);
        });
      job.promise.catch(() => {});
      this.change(id, { status: 'checking', error: '', downloadedBytes: 0, installedBytes: 0 });
    }
    job.users++;
    let failure;
    try {
      await waitFor(job.promise, signal);
    } catch (error) {
      failure = error;
    } finally {
      job.users--;
      if (!job.users && this.jobs.get(id) === job) job.controller.abort();
    }
    signal.throwIfAborted();
    // 조회와 겹친 명시적 준비만, 조회가 끝난 뒤 미설치/손상 구성을 복구한다.
    if (allowInstall && !job.allowInstall && this.rows.get(id).status !== 'ready') {
      return this.acquire(id, signal);
    }
    if (failure) throw failure;
  }

  async run(id, signal, allowInstall = true) {
    const component = this.components.get(id),
      target = this.path(id);
    try {
      const exists = await lstat(target).catch((error) => {
        if (error.code === 'ENOENT') return null;
        throw error;
      });
      signal.throwIfAborted();
      let ready = false;
      if (exists) {
        try {
          await this.verify(target, component, signal);
          ready = true;
        } catch (error) {
          if (!['runtime-integrity', 'ENOENT'].includes(error.code)) throw error;
          signal.throwIfAborted();
        }
      }
      if (!ready && !allowInstall) {
        this.change(id, {
          status: exists ? 'error' : 'idle',
          error: exists
            ? '설치된 구성의 일부가 없거나 손상되었습니다. 해당 기능을 다시 준비해주세요.'
            : '',
        });
        return;
      }
      if (!ready) {
        this.change(id, { status: 'downloading', downloadedBytes: 0, installedBytes: 0 });
        const downloaded = await this.download({
          url: component.archive.url,
          component,
          cache: join(this.cache, 'downloads'),
          signal,
          repair: true,
          onProgress: (p) => this.change(id, { downloadedBytes: p.downloadedBytes }, true),
        });
        signal.throwIfAborted();
        this.change(id, { status: 'installing', downloadedBytes: component.archive.bytes });
        await this.install({
          archive: downloaded.path,
          component,
          cache: join(this.cache, 'installed'),
          signal,
          repair: true,
          onProgress: (p) => this.change(id, { installedBytes: p.extractedBytes }, true),
        });
      }
      signal.throwIfAborted();
      // 압축 사본 정리는 명시적인 준비에서만 수행한다. 시작 시 조회는 읽기 전용이다.
      if (allowInstall) {
        try {
          const archive = join(this.cache, 'downloads', component.archive.sha256 + '.ngpack');
          await regularAncestors(join(this.cache, 'downloads'));
          const stat = await lstat(archive);
          if (stat.isFile() && !stat.isSymbolicLink()) await unlink(archive);
        } catch {}
      }
      this.change(id, {
        status: 'ready',
        downloadedBytes: component.archive.bytes,
        installedBytes: component.bytes,
      });
    } catch (error) {
      this.change(id, {
        status: signal.aborted ? 'idle' : 'error',
        error: signal.aborted
          ? ''
          : allowInstall
            ? '구성을 준비하지 못했습니다. 연결과 저장 공간을 확인한 뒤 다시 시도해주세요.'
            : '설치된 구성을 확인하지 못했습니다. 저장 공간과 접근 권한을 확인한 뒤 다시 준비해주세요.',
      });
      throw new Error(signal.aborted ? '구성 준비를 취소했습니다.' : this.rows.get(id).error, {
        cause: error,
      });
    }
  }

  cancel() {
    for (const controller of this.preparations.keys()) controller.abort();
    for (const job of this.jobs.values()) if (job.allowInstall) job.controller.abort();
  }

  close() {
    if (this.closing) return this.closing;
    this.closed = true;
    this.inspectionController.abort();
    this.cancel();
    for (const job of this.jobs.values()) job.controller.abort();
    this.closing = Promise.allSettled([
      ...this.preparations.values(),
      ...[...this.jobs.values()].map((job) => job.promise),
      this.inspection,
    ]).then(() => {});
    return this.closing;
  }
}

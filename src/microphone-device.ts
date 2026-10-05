export type MicrophoneChoice = { deviceId: string; label: string };
export const concreteMicrophones = (devices: MediaDeviceInfo[]) =>
  devices.filter(
    (device) =>
      device.kind === 'audioinput' &&
      device.deviceId &&
      !['default', 'communications'].includes(device.deviceId),
  );

// Browser permission prompts cannot be aborted. Keep ownership of late streams
// even when a stop, source change or timeout has already settled this attempt.
export function acquireMicrophone({
  deviceId,
  signal,
  mediaDevices = navigator.mediaDevices,
  timeoutMs = 30000,
}: {
  deviceId: string;
  signal: AbortSignal;
  mediaDevices?: Pick<MediaDevices, 'getUserMedia' | 'enumerateDevices'>;
  timeoutMs?: number;
}): Promise<{ stream: MediaStream; choice: MicrophoneChoice }> {
  return new Promise((resolve, reject) => {
    let settled = false,
      stream: MediaStream | undefined;
    const cleanup = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', abort);
    };
    const stop = (value?: MediaStream) => value?.getTracks().forEach((track) => track.stop());
    const fail = (error: unknown) => {
      if (settled) return;
      settled = true;
      cleanup();
      stop(stream);
      reject(error);
    };
    const abort = () => fail(new DOMException('마이크 연결을 취소했습니다.', 'AbortError'));
    const timer = setTimeout(
      () =>
        fail(
          new DOMException(
            '마이크 연결 시간이 지났습니다. 권한과 장치를 확인한 뒤 다시 연결해주세요.',
            'TimeoutError',
          ),
        ),
      timeoutMs,
    );
    signal.addEventListener('abort', abort, { once: true });
    if (signal.aborted) {
      abort();
      return;
    }
    if (['default', 'communications'].includes(deviceId)) {
      fail(new Error('고정된 입력 장치를 선택해주세요.'));
      return;
    }
    void (async () => {
      const value = await mediaDevices.getUserMedia({
        audio: {
          ...(deviceId ? { deviceId: { exact: deviceId } } : {}),
          echoCancellation: true,
          noiseSuppression: true,
          autoGainControl: true,
        },
        video: false,
      });
      if (settled) {
        stop(value);
        return;
      }
      stream = value;
      const track = value.getAudioTracks()[0];
      if (!track || track.readyState !== 'live')
        throw new DOMException(
          '마이크 입력이 종료됐습니다. 장치를 다시 연결해주세요.',
          'NotReadableError',
        );
      const settings = track.getSettings();
      let resolved = settings.deviceId || '';
      if (!resolved || ['default', 'communications'].includes(resolved)) {
        const candidates = concreteMicrophones(await mediaDevices.enumerateDevices()).filter(
          (device) =>
            (settings.groupId && device.groupId === settings.groupId) ||
            device.label === track.label,
        );
        if (candidates.length !== 1)
          throw new DOMException(
            '기본 마이크를 고정하지 못했습니다. 연결 설정에서 사용할 마이크를 선택해주세요.',
            'NotFoundError',
          );
        resolved = candidates[0].deviceId;
      }
      if (deviceId && resolved !== deviceId)
        throw new DOMException(
          '선택한 마이크와 연결된 장치가 다릅니다. 장치를 다시 선택해주세요.',
          'NotFoundError',
        );
      if (settled) {
        stop(value);
        return;
      }
      if (track.readyState !== 'live')
        throw new DOMException('마이크가 연결 중에 분리됐습니다.', 'NotFoundError');
      settled = true;
      cleanup();
      resolve({ stream: value, choice: { deviceId: resolved, label: track.label.slice(0, 200) } });
    })().catch(fail);
  });
}

export function microphoneFailure(error: unknown): { message: string; retryable: boolean } {
  const name = error instanceof Error ? error.name : '';
  const messages: Record<string, string> = {
    NotAllowedError:
      '마이크 권한이 거절됐습니다. Windows와 앱의 마이크 권한을 허용한 뒤 다시 연결해주세요.',
    SecurityError: '마이크 접근이 차단됐습니다. Windows와 앱의 권한 설정을 확인해주세요.',
    NotFoundError:
      '선택한 마이크를 찾을 수 없습니다. 같은 장치를 다시 연결하거나 연결 설정에서 마이크를 바꿔주세요.',
    OverconstrainedError: '선택한 마이크를 사용할 수 없습니다. 연결 설정에서 장치를 확인해주세요.',
    NotReadableError:
      '마이크에서 입력을 받지 못했습니다. 다른 앱의 독점 사용이나 장치 연결을 확인해주세요.',
  };
  return {
    message:
      messages[name] || (error instanceof Error ? error.message : '마이크 연결에 실패했습니다.'),
    retryable: ![
      'AbortError',
      'TimeoutError',
      'NotAllowedError',
      'SecurityError',
      'NotFoundError',
      'OverconstrainedError',
    ].includes(name),
  };
}

// A user start grants at most three automatic retries in total. A successful
// reconnection does not reset the budget and permit an endless flapping loop.
export class MicrophoneRetry {
  requested = false;
  failures = 0;
  nextAt = 0;
  request() {
    this.requested = true;
    this.failures = 0;
    this.nextAt = 0;
  }
  stop() {
    this.requested = false;
    this.nextAt = Infinity;
  }
  ready(now = Date.now()) {
    return this.requested && now >= this.nextAt;
  }
  fail(retryable: boolean, now = Date.now()) {
    if (!this.requested) return false;
    if (!retryable || this.failures >= 3) {
      this.stop();
      return false;
    }
    this.failures++;
    this.nextAt = now + Math.min(5000, 1000 * this.failures);
    return true;
  }
}

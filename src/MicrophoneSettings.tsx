import { useEffect, useState } from 'react';
import { api } from './api';
import { concreteMicrophones, type MicrophoneChoice } from './microphone-device';
import type { State } from './types';

export function MicrophoneSettings({ state }: { state: State }) {
  const selected = state.microphone || { deviceId: '', label: '' };
  const [devices, setDevices] = useState<MediaDeviceInfo[]>([]),
    [choice, setChoice] = useState(selected.deviceId);
  const [message, setMessage] = useState(''),
    [pending, setPending] = useState(false);
  useEffect(() => setChoice(selected.deviceId), [selected.deviceId]);
  useEffect(() => {
    let active = true;
    const refresh = () => {
      void navigator.mediaDevices
        .enumerateDevices()
        .then((values) => {
          if (active) setDevices(concreteMicrophones(values));
        })
        .catch(() => {
          if (active)
            setMessage('입력 장치 목록을 읽지 못했습니다. Windows 마이크 권한을 확인해주세요.');
        });
    };
    refresh();
    navigator.mediaDevices.addEventListener('devicechange', refresh);
    return () => {
      active = false;
      navigator.mediaDevices.removeEventListener('devicechange', refresh);
    };
  }, []);
  async function save() {
    if (!choice) return;
    setPending(true);
    setMessage('');
    try {
      await api<MicrophoneChoice>('microphone/config', {
        deviceId: choice,
        label: devices.find((device) => device.deviceId === choice)?.label || selected.label,
      });
      setMessage(
        state.running
          ? '마이크를 저장했습니다. 사용 중이면 새 장치로 다시 연결합니다.'
          : '마이크를 저장했습니다. 방송 시작 시 이 장치에 연결합니다.',
      );
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '마이크를 저장하지 못했습니다.');
    } finally {
      setPending(false);
    }
  }
  return (
    <fieldset className="provider-picker-fields" disabled={pending} aria-label="입력 마이크">
      <legend>입력 마이크</legend>
      <label>
        사용할 마이크{' '}
        <select
          aria-label="사용할 마이크"
          value={choice}
          onChange={(event) => setChoice(event.target.value)}
        >
          {!selected.deviceId && <option value="">첫 방송 시작 시 기본 마이크 확인 후 고정</option>}
          {selected.deviceId &&
            !devices.some((device) => device.deviceId === selected.deviceId) && (
              <option value={selected.deviceId}>
                {selected.label || '저장된 마이크'} · 연결 확인 필요
              </option>
            )}
          {devices.map((device, index) => (
            <option key={device.deviceId} value={device.deviceId}>
              {device.label || `입력 마이크 ${index + 1}`}
            </option>
          ))}
        </select>
      </label>
      <p className="field-note">
        선택한 마이크가 사라져도 다른 입력으로 바꾸지 않습니다. 처음 권한을 허용하기 전에는 장치
        이름이 표시되지 않을 수 있습니다. 설정을 여는 것만으로 녹음을 시작하지 않습니다.
      </p>
      <button
        className="secondary"
        disabled={!choice || choice === selected.deviceId}
        onClick={() => void save()}
      >
        마이크 저장
      </button>
      {message && <p role="status">{message}</p>}
    </fieldset>
  );
}

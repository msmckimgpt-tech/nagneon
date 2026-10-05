import { useState } from 'react';
import { api } from './api';
import type { State } from './types';

const size = (bytes: number) =>
  bytes >= 1e9 ? (bytes / 1e9).toFixed(2) + ' GB' : Math.ceil(bytes / 1e6) + ' MB';
const busyStates = ['checking', 'downloading', 'installing'];

export function RuntimeDownloads({
  state,
  activeOnly = false,
}: {
  state: State;
  activeOnly?: boolean;
}) {
  const [error, setError] = useState('');
  const rows = state.runtimeComponents?.components;
  if (!rows) return null;
  const checking = rows.some((c) => c.status === 'checking');
  const preparing =
    state.runtimeComponents?.preparing ?? rows.some((c) => busyStates.includes(c.status));
  const failed = rows.some((c) => c.status === 'error');
  // 시작 시 로컬 확인만으로 방송실에 설치 안내를 띄우지 않는다.
  if (activeOnly && !preparing && !failed) return null;
  const prepare = async (feature: string) => {
    setError('');
    try {
      await api('runtime/prepare', { feature });
    } catch (e) {
      setError(e instanceof Error ? e.message : '구성 준비 실패');
    }
  };
  const actions = [
    {
      feature: 'microphone',
      label: '마이크 준비',
      ids: ['audio', 'microphone', ...(state.settings.speechDevice === 'gpu' ? ['gpu'] : [])],
    },
    { feature: 'sound', label: '시스템 소리 준비', ids: ['audio', 'sound'] },
    { feature: 'clips', label: '클립 저장 준비', ids: ['audio'] },
  ];
  return (
    <details className="connection-card" open={preparing || checking || failed || undefined}>
      <summary>추가 구성 {preparing ? '· 준비 중' : checking ? '· 설치 확인 중' : ''}</summary>
      <p className="field-note">
        텍스트와 화면 대화는 기본 앱으로 이용할 수 있어요. 음성·소리·클립 기능은 필요한 구성만 한 번
        설치하고, 다음 실행과 업데이트에서 재사용합니다. 기존 설치를 확인하는 동안에는 다운로드하지
        않아요.
      </p>
      {rows.map((c) => (
        <div key={c.id} className="speech-ready">
          <b>{c.label}</b>
          <span>
            {c.status === 'ready'
              ? '준비됨'
              : c.status === 'checking'
                ? '설치 확인 중'
                : c.status === 'downloading'
                  ? `다운로드 ${size(c.downloadedBytes)} / ${size(c.downloadBytes)}`
                  : c.status === 'installing'
                    ? `설치 ${size(c.installedBytes)} / ${size(c.installBytes)}`
                    : c.status === 'error'
                      ? c.error
                      : `필요 시 설치 · ${size(c.downloadBytes)}`}
          </span>
          {['downloading', 'installing'].includes(c.status) && (
            <progress
              aria-label={c.label + ' 진행률'}
              value={c.status === 'downloading' ? c.downloadedBytes : c.installedBytes}
              max={c.status === 'downloading' ? c.downloadBytes : c.installBytes}
            />
          )}
        </div>
      ))}
      <div className="connection-actions">
        {actions.map(({ feature, label, ids }) => {
          const required = rows.filter((c) => ids.includes(c.id));
          const ready =
            required.length === ids.length && required.every((c) => c.status === 'ready');
          const verifying = required.some((c) => c.status === 'checking');
          const remaining = size(
            required.filter((c) => c.status !== 'ready').reduce((n, c) => n + c.downloadBytes, 0),
          );
          return (
            <button
              key={feature}
              className="secondary"
              disabled={preparing || ready || required.some((c) => busyStates.includes(c.status))}
              onClick={() => void prepare(feature)}
            >
              {label} · {ready ? '준비됨' : verifying ? '설치 확인 중' : remaining}
            </button>
          );
        })}
        {preparing && (
          <button
            className="secondary"
            onClick={() => void api('runtime/cancel').catch((e) => setError(e.message))}
          >
            진행 중인 설치 취소
          </button>
        )}
      </div>
      {error && (
        <p role="alert" className="connection-problem">
          {error}
        </p>
      )}
    </details>
  );
}

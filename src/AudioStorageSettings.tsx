import { useEffect, useState } from 'react';
import { api } from './api';

type Recording = {
  source: 'microphone' | 'system-output';
  sessionId: string;
  inputEpoch: string;
  firstAt: number;
  lastAt: number;
  bytes: number;
  active: boolean;
  expiresAt: number;
};
type Storage = {
  retentionHours: number;
  maxBytes: number;
  usedBytes: number;
  records: Recording[];
};
const size = (bytes: number) =>
  bytes >= 1024 ** 3
    ? `${(bytes / 1024 ** 3).toFixed(1)} GB`
    : `${(bytes / 1024 ** 2).toFixed(1)} MB`;

export function AudioStorageSettings({ running }: { running: boolean }) {
  const [value, setValue] = useState<Storage | null>(null);
  const [hours, setHours] = useState(24),
    [capacity, setCapacity] = useState(2 * 1024 ** 3);
  const [pending, setPending] = useState(false),
    [error, setError] = useState('');
  const [deleting, setDeleting] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    const controller = new AbortController();
    void fetch('/api/audio/storage', { signal: controller.signal })
      .then(async (response) => {
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || '원음 보관 상태를 확인하지 못했습니다.');
        if (!controller.signal.aborted) {
          setValue(result);
          setHours(result.retentionHours);
          setCapacity(result.maxBytes);
        }
      })
      .catch((reason) => {
        if (!controller.signal.aborted) setError(reason.message);
      });
    return () => controller.abort();
  }, [running, revision]);
  async function change(path: string, body: unknown) {
    setPending(true);
    setError('');
    try {
      setValue(await api<Storage>(`audio/storage/${path}`, body));
      setDeleting('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '원음 보관 설정을 처리하지 못했습니다.');
    } finally {
      setPending(false);
    }
  }
  return (
    <fieldset className="provider-picker-fields" disabled={pending} aria-label="원음 보관 관리">
      <legend>원음 보관</legend>
      <button className="secondary" onClick={() => setRevision((value) => value + 1)}>
        보관 상태 새로 확인
      </button>
      <p>음성 연결 복구를 위해 마이크와 게임·시스템 소리 원음을 이 PC에 각각 보관합니다.</p>
      <label>
        보관 기간{' '}
        <select
          aria-label="원음 보관 기간"
          value={hours}
          disabled={running}
          onChange={(e) => setHours(Number(e.target.value))}
        >
          {[1, 6, 24, 72, 168].map((n) => (
            <option key={n} value={n}>
              {n < 24 ? `${n}시간` : `${n / 24}일`}
            </option>
          ))}
        </select>
      </label>
      <label>
        최대 보관 용량{' '}
        <select
          aria-label="원음 보관 용량"
          value={capacity}
          disabled={running}
          onChange={(e) => setCapacity(Number(e.target.value))}
        >
          {[256 * 1024 ** 2, 1024 ** 3, 2 * 1024 ** 3, 4 * 1024 ** 3].map((n) => (
            <option key={n} value={n}>
              {size(n)}
            </option>
          ))}
        </select>
      </label>
      <p className="field-note">
        보관 기간이 지난 원음은 앱 실행 시와 실행 중에 정리합니다. 진행 중인 방송의 원음은 지우지
        않습니다. 용량이 가득 차면 음성 전송을 중지합니다. 기간을 줄이면 해당 기간이 지난 원음이
        삭제됩니다.
      </p>
      <button
        className="secondary"
        disabled={running || !value}
        onClick={() => void change('config', { retentionHours: hours, maxBytes: capacity })}
      >
        보관 설정 적용
      </button>
      <p role="status">
        {error ||
          (value
            ? `보관 중 ${size(value.usedBytes)} / ${size(value.maxBytes)}`
            : '원음 보관 상태 확인 중…')}
      </p>
      {value?.records.length === 0 && <p>보관 중인 원음이 없습니다.</p>}
      {value && value.records.length > 0 && (
        <details>
          <summary>보관된 원음 {value.records.length}개</summary>
          <ul>
            {value.records.map((record) => (
              <li key={`${record.sessionId}/${record.inputEpoch}`}>
                <span>
                  {record.source === 'system-output' ? '게임·시스템 소리' : '마이크'} ·{' '}
                  {new Date(record.firstAt).toLocaleString('ko-KR')} · {size(record.bytes)} ·{' '}
                  {record.active
                    ? '방송 중 · 삭제 보호'
                    : `정리 예정 ${new Date(record.expiresAt).toLocaleString('ko-KR')}`}
                </span>{' '}
                <a href={`/api/audio/storage/${record.sessionId}/${record.inputEpoch}`} download>
                  원음 저장
                </a>{' '}
                {!record.active &&
                  (deleting === record.inputEpoch ? (
                    <>
                      <span>이 원음은 복구할 수 없습니다. 삭제할까요?</span>{' '}
                      <button
                        className="secondary"
                        onClick={() =>
                          void change('delete', {
                            sessionId: record.sessionId,
                            inputEpoch: record.inputEpoch,
                            confirm: true,
                          })
                        }
                      >
                        원음 삭제 확인
                      </button>{' '}
                      <button className="secondary" onClick={() => setDeleting('')}>
                        취소
                      </button>
                    </>
                  ) : (
                    <button className="secondary" onClick={() => setDeleting(record.inputEpoch)}>
                      원음 삭제
                    </button>
                  ))}
              </li>
            ))}
          </ul>
        </details>
      )}
    </fieldset>
  );
}

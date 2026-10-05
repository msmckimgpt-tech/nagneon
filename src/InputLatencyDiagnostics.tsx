import { useState } from 'react';
import { api } from './api';
type Distribution = {
  samples: number;
  p50Ms: number | null;
  p95Ms: number | null;
  maxMs: number | null;
};
type Report = {
  retained: number;
  approximateCaptureSamples: number;
  stages: Record<string, Distribution>;
};
const stages: Record<string, string> = {
  captureToTranscript: '음성 구간 종료 → 마지막 전사 조각 관측',
  transcriptAssembly: '첫 전사 조각 → 마지막 조각 관측',
  transcriptToReceipt: '마지막 전사 조각 → 나그네온 접수',
  receiptToRequest: '접수 → 관객 요청',
  model: '관객 응답 생성',
  responseToPublish: '응답 완료 → 채팅 전달',
  publishToRenderer: '채팅 전달 → 앱 표시 확인',
  captureToRenderer: '음성 구간 종료 → 앱 표시 확인',
};
const duration = (value: number | null) =>
  value === null ? '측정 없음' : `${(value / 1000).toFixed(2)}초`;
export function InputLatencyDiagnostics() {
  const [report, setReport] = useState<Report | null>(null),
    [error, setError] = useState(''),
    [loading, setLoading] = useState(false);
  async function refresh() {
    if (loading) return;
    setLoading(true);
    setError('');
    try {
      setReport(await api<Report>('diagnostics/input-latency', undefined, 'GET'));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : '음성 전달 시간을 확인하지 못했습니다.');
    } finally {
      setLoading(false);
    }
  }
  return (
    <details
      className="reaction-diagnostics"
      onToggle={(event) => {
        if (event.currentTarget.open && !report) void refresh();
      }}
    >
      <summary>발언이 늦게 전달될 때 · 단계별 대기 시간</summary>
      <p className="muted">
        최근 마이크 발언의 전달 단계를 확인합니다. 구독 음성의 발화 구간은 제공자의 추정 시각이며
        전사 관측 시각과 구분합니다. 전사 조각을 모으는 시간은 발언 길이도 포함합니다. 추정 구간과
        수신 시각의 순서가 맞지 않는 표본, 채팅하지 않은 발언과 보이지 않는 창의 표시 시간은 측정
        없음으로 남습니다.
      </p>
      {report && (
        <table>
          <thead>
            <tr>
              <th>단계</th>
              <th>중앙값</th>
              <th>95백분위</th>
              <th>측정 수</th>
            </tr>
          </thead>
          <tbody>
            {Object.entries(stages).map(([id, label]) => {
              const value = report.stages[id];
              return (
                <tr key={id}>
                  <td>{label}</td>
                  <td>{duration(value?.p50Ms ?? null)}</td>
                  <td>{duration(value?.p95Ms ?? null)}</td>
                  <td>{value?.samples || 0}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      )}
      {error && <p role="alert">{error}</p>}
      <div className="connection-actions">
        <button className="secondary" disabled={loading} onClick={() => void refresh()}>
          {loading ? '확인 중…' : '새로 확인'}
        </button>
        <a className="text-button" href="/api/diagnostics/input-latency?download=true" download>
          전달 시간 다운로드
        </a>
      </div>
      <p className="muted">
        시각과 처리 건수만 보관하며 원음·화면·전사 원문을 넣지 않습니다. 새 방송 시작이나 앱 종료 시
        초기화됩니다.
      </p>
    </details>
  );
}

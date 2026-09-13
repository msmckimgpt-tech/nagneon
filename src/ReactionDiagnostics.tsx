import {useState} from 'react';
import {api} from './api';
type Report={limit:number;summary:{attempts:number;retained:number;modelSilent:number;generated:number;delivered:number;pending:number;rejected:Record<string,number>;outcomes:Record<string,number>;modelP50Ms:number|null;modelP95Ms:number|null;firstChatSamples:number;firstChatWaitP50Ms:number|null;firstChatWaitP95Ms:number|null}};
const labels:Record<string,string>={expired:'시간이 지나 보류',absent:'참여 범위가 달라짐',disabled:'관객 비활성화',blocked:'금칙어',duplicate:'중복',spoiler:'스포일러',advice:'훈수 제한',pace:'채팅 속도 제한',cleared:'새 발언·종료·정리로 취소','delivery-error':'표시 처리 오류'};
const outcomes:Record<string,string>={generating:'응답 생성 중',superseded:'새 입력·화면 해제로 취소',stopped:'방송 종료로 취소','stale-screen':'화면 반응 기한 초과','transcription-review':'음성 교정 의미 확인 필요',error:'응답 처리 오류'};
const seconds=(value:number|null)=>value===null?'측정 없음':`${(value/1000).toFixed(1)}초`;
export function ReactionDiagnostics(){
  const [report,setReport]=useState<Report|null>(null),[loading,setLoading]=useState(false),[error,setError]=useState('');
  async function refresh(){if(loading)return;setLoading(true);setError('');try{setReport(await api<Report>('diagnostics/reactions',undefined,'GET'));}catch(e){setError(e instanceof Error?e.message:'진단을 불러오지 못했습니다.');}finally{setLoading(false);}}
  return <details className="reaction-diagnostics" onToggle={e=>{if(e.currentTarget.open&&!report&&!loading)void refresh();}}><summary>채팅이 뜸하거나 늦을 때 · 응답 진단</summary>
    <p className="muted">이번 방송의 최근 {report?.limit||120}회 일반 응답을 확인합니다. 관객 생성·특수 기능·커뮤니티 활동은 제외합니다. 방송을 종료해도 남고, 다음 방송 시작 또는 앱 종료 시 지워집니다.</p>
    {error&&<p role="alert">{error}</p>}
    {report&&<><p>모델 호출 {report.summary.attempts}회 · 아래 집계는 최근 {report.summary.retained}회 기준</p><div className="tags"><span>모델이 채팅하지 않음 {report.summary.modelSilent}회</span><span>생성 {report.summary.generated}개</span><span>표시 {report.summary.delivered}개</span><span>대기 {report.summary.pending}개</span></div>
      <p>완료된 모델 응답 시간 · 중앙값 {seconds(report.summary.modelP50Ms)} / 95백분위 {seconds(report.summary.modelP95Ms)}</p>
      <p>응답 완료 후 첫 채팅 전달 대기 · 중앙값 {seconds(report.summary.firstChatWaitP50Ms)} / 95백분위 {seconds(report.summary.firstChatWaitP95Ms)} ({report.summary.firstChatSamples}회)</p>
      <p className="muted">실제로 채팅을 전달한 응답만 집계하며, 슬로우 모드와 서버 처리 대기를 포함합니다. 화면에 그려지는 시간은 측정하지 않습니다.</p>
      <p className="muted">마이크 전사·화면 연결·채팅 표시 대기 시간은 모델 응답 시간에 포함되지 않습니다. 채팅하지 않은 응답은 오류를 뜻하지 않습니다.</p>
      {Object.entries(report.summary.outcomes).filter(([reason,n])=>!!outcomes[reason]&&n>0).map(([reason,n])=><p key={reason}>{outcomes[reason]}: {n}회</p>)}
      {Object.entries(report.summary.rejected).filter(([,n])=>n>0).map(([reason,n])=><p key={reason}>{labels[reason]||'기타 보류'}: {n}개</p>)}</>}
    <div className="connection-actions"><button className="secondary" disabled={loading} onClick={()=>void refresh()}>{loading?'확인 중…':'새로 확인'}</button><a className="text-button" href="/api/diagnostics/reactions?download=true" download>응답 진단 다운로드</a></div>
    <p className="muted">진단에는 시간과 처리 건수만 포함됩니다. 대화 원문·화면·음성·관객 신원은 포함하지 않습니다.</p>
  </details>;
}

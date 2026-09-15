import { useState } from 'react';
import { api } from './api';
import type { State } from './types';
const size=(bytes:number)=>bytes>=1e9?(bytes/1e9).toFixed(2)+' GB':Math.ceil(bytes/1e6)+' MB';
export function RuntimeDownloads({state,activeOnly=false}:{state:State;activeOnly?:boolean}){
  const [error,setError]=useState('');
  const rows=state.runtimeComponents?.components;
  if(!rows)return null;
  const busy=rows.some(c=>['checking','downloading','installing'].includes(c.status));
  if(activeOnly&&!busy&&!rows.some(c=>c.status==='error'))return null;
  const prepare=async(feature:string)=>{setError('');try{await api('runtime/prepare',{feature});}catch(e){setError(e instanceof Error?e.message:'구성 준비 실패');}};
  const remaining=(ids:string[])=>size(rows.filter(c=>ids.includes(c.id)&&c.status!=='ready').reduce((n,c)=>n+c.downloadBytes,0));
  return <details className="connection-card" open={busy||rows.some(c=>c.status==='error')||undefined}>
    <summary>추가 구성 {busy?'· 준비 중':''}</summary>
    <p className="field-note">텍스트와 화면 대화는 기본 앱으로 이용할 수 있어요. 음성·소리·클립 기능은 필요한 구성만 한 번 설치하고, 다음 실행과 업데이트에서 재사용합니다. 표시한 용량은 아직 확인되지 않은 구성의 다운로드 크기예요.</p>
    {rows.map(c=><div key={c.id} className="speech-ready"><b>{c.label}</b><span>{c.status==='ready'?'준비됨':c.status==='checking'?'설치 확인 중':c.status==='downloading'?`다운로드 ${size(c.downloadedBytes)} / ${size(c.downloadBytes)}`:c.status==='installing'?`설치 ${size(c.installedBytes)} / ${size(c.installBytes)}`:c.status==='error'?c.error:`필요 시 설치 · ${size(c.downloadBytes)}`}</span>{['downloading','installing'].includes(c.status)&&<progress aria-label={c.label+' 진행률'} value={c.status==='downloading'?c.downloadedBytes:c.installedBytes} max={c.status==='downloading'?c.downloadBytes:c.installBytes}/>}</div>)}
    <div className="connection-actions">
      <button className="secondary" disabled={busy} onClick={()=>void prepare('microphone')}>마이크 준비 · {remaining(['audio','microphone',...(state.settings.speechDevice==='gpu'?['gpu']:[])])}</button>
      <button className="secondary" disabled={busy} onClick={()=>void prepare('sound')}>시스템 소리 준비 · {remaining(['audio','sound'])}</button>
      <button className="secondary" disabled={busy} onClick={()=>void prepare('clips')}>클립 저장 준비 · {remaining(['audio'])}</button>
      {busy&&<button className="secondary" onClick={()=>void api('runtime/cancel').catch(e=>setError(e.message))}>진행 중인 설치 취소</button>}
    </div>
    {error&&<p role="alert" className="connection-problem">{error}</p>}
  </details>;
}

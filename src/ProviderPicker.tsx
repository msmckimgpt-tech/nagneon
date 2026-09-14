import {useState} from 'react';
import {api} from './api';
import type {State} from './types';

export function ProviderPicker({state,disabled}:{state:State;disabled:boolean}){
  const current=state.providerChoice?.config;
  const [kind,setKind]=useState(current?.kind||'codex'),[model,setModel]=useState(current?.model||''),[base,setBase]=useState(current?.base||'http://127.0.0.1:11434'),[context,setContext]=useState(current?.contextSize||65536),[pending,setPending]=useState(false),[error,setError]=useState('');
  if(!current)return null;
  async function apply(){setPending(true);setError('');try{await api('connection/provider',kind==='ollama'?{kind,model,base,contextSize:context}:{kind});}catch(e){setError(e instanceof Error?e.message:'제공처 변경에 실패했습니다.');}finally{setPending(false);}}
  return <details className="login-alternative"><summary>AI 제공처 선택</summary>
    <fieldset disabled={disabled||pending||state.providerChoice?.changing}>
      <label>제공처 <select aria-label="AI 제공처" value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="codex">ChatGPT 구독 · Codex</option><option value="ollama">이 PC의 Ollama</option><option value="openai">OpenAI API</option></select></label>
      {kind==='ollama'&&<>
        <p>Ollama에 모델을 먼저 설치한 뒤 정확한 모델명을 입력하세요. 화면 반응에는 이미지 이해 모델이 필요합니다.</p>
        <label>모델명 <input aria-label="Ollama 모델명" value={model} onChange={e=>setModel(e.target.value)} placeholder="설치한 모델명" maxLength={200}/></label>
        <label>로컬 주소 <input aria-label="Ollama 주소" value={base} onChange={e=>setBase(e.target.value)} maxLength={200}/></label>
        <label>문맥 크기 <input aria-label="Ollama 문맥 크기" type="number" min={4096} max={131072} value={context} onChange={e=>setContext(Number(e.target.value))}/></label>
        <p className="field-note">문맥 크기가 클수록 메모리가 더 필요합니다. 적용 시 설치된 로컬 모델을 확인하며, 모델을 자동 다운로드하지 않습니다.</p>
      </>}
      {kind==='openai'&&<p className="field-note">별도 API 사용 요금이 발생합니다. 적용 후 API 키를 입력하세요.</p>}
      <button className="secondary" onClick={()=>void apply()}>{pending?'연결 확인 중…':'선택한 제공처 적용'}</button>
    </fieldset>
    {error&&<p role="alert" className="connection-problem">{error}</p>}
  </details>;
}

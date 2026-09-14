import {useState} from 'react';
import {api} from './api';
import type {State} from './types';

export function ProviderPicker({state,disabled}:{state:State;disabled:boolean}){
  const current=state.providerChoice?.config;
  const [kind,setKind]=useState(current?.kind||'codex'),[model,setModel]=useState(current?.model||'gpt-6-astra'),[effort,setEffort]=useState(current?.effort||'low'),[bin,setBin]=useState(current?.bin||''),[base,setBase]=useState(current?.base||'http://127.0.0.1:11434'),[context,setContext]=useState(current?.contextSize||65536),[pending,setPending]=useState(false),[error,setError]=useState('');
  if(!current)return null;
  async function apply(){setPending(true);setError('');try{await api('connection/provider',kind==='ollama'?{kind,model,base,contextSize:context}:['codex','openai'].includes(kind)?{kind,model,effort}:kind.endsWith('-cli')?{kind,model,bin}:{kind,model});}catch(e){setError(e instanceof Error?e.message:'제공처 변경에 실패했습니다.');}finally{setPending(false);}}
  return <details className="login-alternative"><summary>AI 제공처 선택</summary>
    <fieldset disabled={disabled||pending||state.providerChoice?.changing}>
      <label>제공처 <select aria-label="AI 제공처" value={kind} onChange={e=>{const next=e.target.value as typeof kind;setKind(next);setModel(next==='codex'||next==='openai'?'gpt-6-astra':'');}}><option value="codex">ChatGPT 구독 · Codex</option><option value="ollama">이 PC의 Ollama</option><option value="openai">OpenAI API</option><option value="claude-cli">Claude 구독 · 공식 CLI</option><option value="gemini-cli">Gemini Google 계정 · 공식 CLI</option><option value="claude">Claude API</option><option value="gemini">Gemini API</option></select></label>
      {kind==='ollama'&&<>
        <p>Ollama에 모델을 먼저 설치한 뒤 정확한 모델명을 입력하세요. 화면 반응에는 이미지 이해 모델이 필요합니다.</p>
        <label>모델명 <input aria-label="Ollama 모델명" value={model} onChange={e=>setModel(e.target.value)} placeholder="설치한 모델명" maxLength={200}/></label>
        <label>로컬 주소 <input aria-label="Ollama 주소" value={base} onChange={e=>setBase(e.target.value)} maxLength={200}/></label>
        <label>문맥 크기 <input aria-label="Ollama 문맥 크기" type="number" min={4096} max={131072} value={context} onChange={e=>setContext(Number(e.target.value))}/></label>
        <p className="field-note">문맥 크기가 클수록 메모리가 더 필요합니다. 적용 시 설치된 로컬 모델을 확인하며, 모델을 자동 다운로드하지 않습니다.</p>
      </>}
      {kind.endsWith('-cli')&&<><p>공식 CLI에서 먼저 로그인해주세요. Claude는 <code>claude auth login</code>, Gemini는 <code>gemini</code> 실행 후 Google 로그인을 선택합니다. 앱은 로그인 토큰을 읽거나 복사하지 않습니다.</p><label>CLI 실행 파일 경로 (빈 값은 자동 탐색)<input aria-label="CLI 실행 파일" value={bin} onChange={e=>setBin(e.target.value)} placeholder="공식 .exe 또는 .js 절대 경로" maxLength={500}/></label><p className="field-note">Claude Code 2.1.270+, Gemini CLI 0.59.0+가 필요합니다. 계정 요금제·조직 정책에 따라 허용 모델과 사용량이 달라집니다.</p></>}
      {kind!=='ollama'&&<label>모델 ID <input aria-label="AI 모델명" value={model} onChange={e=>setModel(e.target.value)} placeholder="계정에서 사용할 수 있는 정확한 모델 ID" maxLength={200}/></label>}
      {['codex','openai'].includes(kind)&&<label>추론 수준 <select aria-label="AI 추론 수준" value={effort} onChange={e=>setEffort(e.target.value)}>{['none','minimal','low','medium','high','xhigh','max'].map(value=><option key={value}>{value}</option>)}</select></label>}
      <p className="field-note">모델마다 지원하는 입력·추론 수준이 다릅니다. 적용 후 응답 확인으로 접근 권한을 시험하세요. 실패 시 다른 모델로 자동 전환하지 않습니다.</p>
      {['openai','claude','gemini'].includes(kind)&&<p className="field-note">별도 API 사용 요금이 발생합니다. 적용 후 API 키를 입력하세요.</p>}
      {current.kind.endsWith('-cli')&&<button className="secondary" onClick={()=>{setPending(true);setError('');void api('connection/cli/login').catch(e=>setError(e.message)).finally(()=>setPending(false));}}>공식 CLI 로그인 창 열기</button>}
      <button className="secondary" onClick={()=>void apply()}>{pending?'연결 확인 중…':'선택한 제공처 적용'}</button>
    </fieldset>
    {error&&<p role="alert" className="connection-problem">{error}</p>}
  </details>;
}

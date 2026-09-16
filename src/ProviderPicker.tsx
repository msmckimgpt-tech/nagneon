import {useEffect,useState} from 'react';
import {api} from './api';
import type {State} from './types';
import audienceModels from '../shared/audience-models.json';

export function ProviderPicker({state,disabled}:{state:State;disabled:boolean}){
  const current=state.providerChoice?.config;
  const [kind,setKind]=useState(current?.kind||'codex'),[model,setModel]=useState(current?.kind==='ollama'?current.model||'':''),[hostedModel,setHostedModel]=useState(current?.kind!=='ollama'?current?.model||'':''),[effort,setEffort]=useState(current?.effort||''),[base,setBase]=useState(current?.base||'http://127.0.0.1:11434'),[context,setContext]=useState(current?.contextSize||65536),[pending,setPending]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  useEffect(()=>{
    if(!current)return;
    setKind(current.kind);setEffort(current.effort||'');
    if(current.kind==='ollama'){setModel(current.model||'');setBase(current.base||'http://127.0.0.1:11434');setContext(current.contextSize||65536);}
    else setHostedModel(current.model||'');
  },[current?.kind,current?.model,current?.effort,current?.base,current?.contextSize]);
  const efforts=audienceModels.models.find(m=>m.id===hostedModel)?.efforts||['low','medium','high','xhigh'];
  if(!current)return null;
  async function apply(){setPending(true);setError('');setSaved(false);try{await api('connection/provider',kind==='ollama'?{kind,model,base,contextSize:context}:{kind,...hostedModel?{model:hostedModel}:{},...effort?{effort}:{}});setSaved(true);}catch(e){setError(e instanceof Error?e.message:'제공처 변경에 실패했습니다.');}finally{setPending(false);}}
  return <details className="login-alternative"><summary>AI 제공처·관객 모델 선택</summary>
    <fieldset className="provider-picker-fields" disabled={disabled||pending||state.providerChoice?.changing} onChange={()=>setSaved(false)}>
      <label>제공처 <select aria-label="AI 제공처" value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="codex">ChatGPT 구독 · Codex</option><option value="ollama">이 PC의 Ollama</option><option value="openai">OpenAI API</option></select></label>
      {kind==='ollama'&&<>
        <p>Ollama에 모델을 먼저 설치한 뒤 정확한 모델명을 입력하세요. 화면 반응에는 이미지 이해 모델이 필요합니다.</p>
        <label>모델명 <input aria-label="Ollama 모델명" value={model} onChange={e=>setModel(e.target.value)} placeholder="설치한 모델명" maxLength={200}/></label>
        <label>로컬 주소 <input aria-label="Ollama 주소" value={base} onChange={e=>setBase(e.target.value)} maxLength={200}/></label>
        <label>문맥 크기 <input aria-label="Ollama 문맥 크기" type="number" min={4096} max={131072} value={context} onChange={e=>setContext(Number(e.target.value))}/></label>
        <p className="field-note">문맥 크기가 클수록 메모리가 더 필요합니다. 적용 시 설치된 로컬 모델을 확인하며, 모델을 자동 다운로드하지 않습니다.</p>
        <details className="usage-details"><summary>로컬 모델 실측과 선택 안내</summary><p>2026-09-16 RTX 2070 8GB 실측에서 Qwen3.5 0.8B, Gemma 3 1B, Qwen2.5 1.5B는 현재 앱의 관객 반응을 맡기기에 만족할 만한 성능과 품질을 보이지 않았습니다. 연결 확인과 실제 대화 품질은 다릅니다.</p><p>Qwen 0.8B는 응답 지연·미완료와 문맥 오류가 있었고, Gemma 1B·Qwen2.5 1.5B는 전체 입력의 문맥 예산 검사에서 막혔습니다. 짧은 반응 전용 시험 결과를 전체 앱 성능으로 보지는 마세요. 다른 모델·PC의 결과는 별도 확인이 필요합니다.</p><p>기본 사용은 ChatGPT 구독 · Codex를 권합니다. 로컬 모델 시험 후에도 이 선택으로 돌아갈 수 있습니다.</p></details>
      </>}
      {kind!=='ollama'&&<>
        <label>관객 모델 <select aria-label="관객 모델" value={hostedModel} onChange={e=>{setHostedModel(e.target.value);const next=audienceModels.models.find(m=>m.id===e.target.value)?.efforts||['low','medium','high','xhigh'];if(effort&&!next.includes(effort))setEffort('low');}}>
          <option value="">앱 기본 설정 사용</option>{audienceModels.models.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}
        </select></label>
        <label>추론 수준 <select aria-label="관객 추론 수준" value={effort} onChange={e=>setEffort(e.target.value)}>
          <option value="">앱 기본 설정 사용</option>{efforts.map(value=><option key={value} value={value}>{audienceModels.effortLabels[value as keyof typeof audienceModels.effortLabels]}</option>)}
        </select></label>
        <p className="field-note">관객의 대화·화면 반응과 관객 활동에 사용하는 모델입니다. 낮은 추론 수준부터 반응 속도와 말투를 비교해보세요. 음성 인식 설정은 별도입니다.</p>
        {kind==='codex'&&<p className="field-note">모델 이용 가능 여부는 구독과 계정에 따라 달라집니다. 저장 후 ‘모델 응답 확인’으로 실제 응답을 확인하세요.</p>}
      </>}
      {kind==='openai'&&<p className="field-note">별도 API 사용 요금이 발생합니다. 적용 후 API 키를 입력하세요.</p>}
      <button className="secondary" onClick={()=>void apply()}>{pending?'연결 확인 중…':'선택한 설정 적용'}</button>
    </fieldset>
    {saved&&<p role="status">설정을 저장했습니다. 다음 관객 요청부터 적용됩니다.</p>}
    {error&&<p role="alert" className="connection-problem">{error}</p>}
  </details>;
}

import {useEffect,useState} from 'react';
import {api} from './api';
import type {State} from './types';
import audienceModels from '../shared/audience-models.json';
import {ProviderRouting} from './ProviderRouting';

const defaultGeminiModel='gemini-3.8-flash-low';
const geminiDefaults=[
  {id:defaultGeminiModel,label:'Gemini 3.8 Flash · 낮음'},
  {id:'gemini-3.8-flash-medium',label:'Gemini 3.8 Flash · 중간'},
  {id:'gemini-3.8-flash-high',label:'Gemini 3.8 Flash · 높음'},
  {id:'gemini-3.1-pro-low',label:'Gemini 3.1 Pro · 낮음'},
  {id:'gemini-3.1-pro-high',label:'Gemini 3.1 Pro · 높음'},
];

export function ProviderPicker({state,disabled}:{state:State;disabled:boolean}){
  const current=state.providerChoice?.config;
  const [kind,setKind]=useState(current?.kind||'codex'),[model,setModel]=useState(current?.kind==='ollama'?current.model||'':''),[hostedModel,setHostedModel]=useState(current?.kind==='codex'||current?.kind==='openai'?current.model||'':''),[geminiModel,setGeminiModel]=useState(current?.kind==='antigravity'?current.model||defaultGeminiModel:defaultGeminiModel),[effort,setEffort]=useState(current?.kind!=='antigravity'?current?.effort||'':''),[base,setBase]=useState(current?.base||'http://127.0.0.1:11434'),[context,setContext]=useState(current?.contextSize||65536),[pending,setPending]=useState(false),[error,setError]=useState(''),[saved,setSaved]=useState(false);
  useEffect(()=>{
    if(!current)return;
    setKind(current.kind);
    if(current.kind==='ollama'){setModel(current.model||'');setBase(current.base||'http://127.0.0.1:11434');setContext(current.contextSize||65536);}
    else if(current.kind==='antigravity')setGeminiModel(current.model||defaultGeminiModel);
    else {setHostedModel(current.model||'');setEffort(current.effort||'');}
  },[current?.kind,current?.model,current?.effort,current?.base,current?.contextSize]);
  const efforts=audienceModels.models.find(m=>m.id===hostedModel)?.efforts||['low','medium','high','xhigh'];
  const geminiModels=state.provider.kind==='antigravity'&&state.provider.models?.length?state.provider.models:geminiDefaults;
  if(!current)return null;
  async function apply(){setPending(true);setError('');setSaved(false);try{await api('connection/provider',kind==='antigravity'?{kind,model:geminiModel}:kind==='ollama'?{kind,model,base,contextSize:context}:{kind,...hostedModel?{model:hostedModel}:{},...effort?{effort}:{}});setSaved(true);}catch(e){setError(e instanceof Error?e.message:'제공처 변경에 실패했습니다.');}finally{setPending(false);}}
  return <><details className="login-alternative" open><summary>{state.providerChoice?.routing?'단일 모델로 전환':'AI 제공처·관객 모델 선택'}</summary>
    <fieldset className="provider-picker-fields" disabled={disabled||pending||state.providerChoice?.changing} onChange={()=>setSaved(false)}>
      <label>제공처 <select aria-label="AI 제공처" value={kind} onChange={e=>setKind(e.target.value as typeof kind)}><option value="codex">ChatGPT 구독 · Codex</option><option value="antigravity">Antigravity · Gemini</option><option value="ollama">이 PC의 Ollama</option><option value="openai">OpenAI API</option></select></label>
      {kind==='ollama'&&<>
        <p>Ollama에 모델을 먼저 설치한 뒤 정확한 모델명을 입력하세요. 화면 반응에는 이미지 이해 모델이 필요합니다.</p>
        <label>모델명 <input aria-label="Ollama 모델명" value={model} onChange={e=>setModel(e.target.value)} placeholder="설치한 모델명" maxLength={200}/></label>
        <label>로컬 주소 <input aria-label="Ollama 주소" value={base} onChange={e=>setBase(e.target.value)} maxLength={200}/></label>
        <label>문맥 크기 <input aria-label="Ollama 문맥 크기" type="number" min={4096} max={131072} value={context} onChange={e=>setContext(Number(e.target.value))}/></label>
        <p className="field-note">문맥 크기가 클수록 메모리가 더 필요합니다. 적용 시 설치된 로컬 모델을 확인하며, 모델을 자동 다운로드하지 않습니다.</p>
      </>}
      {kind==='antigravity'&&<>
        <label>Gemini 모델 <select aria-label="Gemini 모델" value={geminiModel} onChange={e=>setGeminiModel(e.target.value)}>
          {!geminiModels.some(m=>m.id===geminiModel)&&<option value={geminiModel}>{geminiModel}</option>}
          {geminiModels.map(m=><option key={m.id} value={m.id}>{m.label}</option>)}
        </select></label>
        <p className="field-note">Antigravity에 연결한 Google 계정으로 Gemini를 사용합니다. API 키는 필요하지 않으며, 해당 계정의 모델 이용 권한과 사용량이 적용됩니다. 대화와 선택한 화면이 전달됩니다.</p>
        <p className="field-note">처음 연결할 때는 Antigravity CLI에서 한 번 로그인한 뒤 ‘연결 상태 새로고침’을 누르세요.</p>
      </>}
      {(kind==='codex'||kind==='openai')&&<>
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
  </details>{current.kind!=='antigravity'&&kind!=='antigravity'&&<ProviderRouting state={state} disabled={disabled}/>}</>;
}

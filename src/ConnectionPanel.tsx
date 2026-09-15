import {useEffect,useState} from 'react';
import {Check,ExternalLink,LoaderCircle,RefreshCw,Radio} from 'lucide-react';
import {api} from './api';
import {ProviderPicker} from './ProviderPicker';
import type {AccountState,State} from './types';

export function ConnectionPanel({state}:{state:State}){
  const [account,setAccount]=useState<AccountState>({status:'idle'}),[error,setError]=useState(''),[pending,setPending]=useState(false),[now,setNow]=useState(Date.now());
  useEffect(()=>{
    const bridge=window.backseat;if(!bridge?.accountStatus)return;
    let active=true;void bridge.accountStatus().then(v=>{if(active)setAccount(v);}).catch(()=>{});
    const off=bridge.onAccountState(setAccount);const timer=setInterval(()=>setNow(Date.now()),1000);
    return()=>{active=false;off();clearInterval(timer);};
  },[]);
  const logging=['checking','starting','waiting','cancelling'].includes(account.status);
  const probe=state.connectionProbe;
  const checking=probe?.status==='checking';
  const disabled=state.running||state.busy||pending||logging;
  async function perform(fn:()=>Promise<unknown>){setPending(true);setError('');try{await fn();}catch(e){setError(e instanceof Error?e.message:'연결 요청에 실패했습니다.');}finally{setPending(false);}}
  async function login(method:'browser'|'device'){await perform(async()=>{if(window.backseat)setAccount(await window.backseat.startAccountLogin(method));});}
  const canLogin=state.provider.kind==='codex'&&window.backseat?.startAccountLogin;
  return <section className="account-panel" aria-label="계정과 모델 연결">
    <div className="account-summary"><span className={'connection-orb '+(state.provider.configured?'ready':'')}><Radio size={20}/></span><div><b>{state.provider.authMessage||(state.provider.configured?'AI 연결 준비됨':'AI 연결이 필요합니다.')}</b><p>{state.provider.model} · 추론 {state.provider.effort}</p></div>{state.provider.configured&&<Check size={20}/>}</div>
    <p className="account-note">{state.provider.kind==='ollama'?'이 PC의 Ollama 모델을 사용합니다. 한국어 품질과 속도는 모델과 PC 성능에 따라 달라요. 로컬 모드에서는 웹 검색을 지원하지 않아요.':state.provider.kind==='openai'?'OpenAI API 사용량으로 별도 청구됩니다.':'ChatGPT 구독의 Codex 사용량을 이용합니다. 계정 연결만으로 이 모델의 접근 권한이나 남은 사용량이 보장되지는 않습니다.'}</p>
    <ProviderPicker state={state} disabled={disabled}/>
    <details className="usage-details"><summary>사용량 참고</summary><div className="probe-result" aria-label="세션 사용량"><div><b>세션 모델 요청 {state.calls.toLocaleString('ko-KR')}회</b><p>제공처가 보고한 누적 토큰 {state.tokens.toLocaleString('ko-KR')}개</p><small>실패한 요청도 횟수에 포함될 수 있어요. 연결 시험과 계정 전체 사용량은 별도이며, 토큰 수는 요금이나 남은 구독량을 뜻하지 않습니다.</small><p>현재 반응 간격에서 자동 화면 반응은 10분당 약 {Math.ceil(600/state.settings.intervalSeconds)}회 수준입니다. 계속 화면을 공유할 때의 간격 기준 예상치이며, 응답 대기·화면 변화·대화와 다른 활동에 따라 실제 요청은 달라집니다.</p></div></div></details>
    <div className="connection-actions">
      {!state.provider.configured&&canLogin&&<button className="primary" disabled={disabled} onClick={()=>void login('browser')}><ExternalLink size={15}/> ChatGPT 계정 연결</button>}
      <button className="secondary" disabled={disabled} onClick={()=>void perform(()=>api('connection/check'))}><RefreshCw size={14}/> 연결 상태 새로고침</button>
      {state.provider.configured&&<button className="secondary" disabled={disabled} onClick={()=>void perform(()=>api('connection/probe'))}><Radio size={14}/> {state.provider.kind==='ollama'?'로컬 모델 응답 확인 · 1회':'모델 응답 확인 · 1회 사용'}</button>}
    </div>
    {state.provider.kind!=='ollama'&&!state.provider.configured&&!window.backseat&&<p className="field-note">계정 로그인은 Windows 데스크톱 앱에서 진행하세요.</p>}
    {!state.provider.configured&&canLogin&&!logging&&<details className="login-alternative"><summary>브라우저 로그인이 열리지 않나요?</summary><p>기기 코드 로그인은 베타 기능입니다. 계정의 보안 설정 또는 조직 권한에서 허용되어 있어야 합니다.</p><button className="secondary" disabled={disabled} onClick={()=>void login('device')}>기기 코드로 연결</button></details>}
    {logging&&<div className="login-progress" role="status">
      {account.status==='waiting'?<><b>{account.method==='device'?'공식 로그인 페이지에 코드를 입력하세요':'브라우저에서 ChatGPT 로그인을 마쳐주세요'}</b>{account.code&&<code className="device-code">{account.code}</code>}<p>{account.method==='device'?'지금 시작한 로그인에만 이 코드를 사용하세요.':'로그인을 마치면 이 창에 자동으로 반영됩니다.'}{account.expiresAt&&` · 남은 시간 ${Math.max(0,Math.ceil((account.expiresAt-now)/60000))}분`}</p><button className="secondary" onClick={()=>void perform(()=>window.backseat!.openAccountLogin())}>공식 로그인 페이지 열기 <ExternalLink size={14}/></button></>:<p><LoaderCircle size={14} className="spin"/> {account.message||'계정 연결 준비 중…'}</p>}
      <button className="text-button" disabled={account.status==='cancelling'} onClick={()=>void perform(async()=>setAccount(await window.backseat!.cancelAccountLogin()))}>로그인 취소</button>
    </div>}
    {account.status==='failed'&&<p role="alert" className="connection-problem">{account.message}</p>}
    {account.status==='expired'&&<p role="status">로그인 시간이 만료되었습니다. 새 로그인을 시작해주세요.</p>}
    {account.status==='cancelled'&&<p role="status">로그인을 취소했습니다. 리허설은 계정 없이 이용할 수 있어요.</p>}
    {checking&&<div className="probe-result" role="status"><LoaderCircle size={17} className="spin"/><div><b>모델의 첫 인사를 기다리는 중</b><p>화면·음성·기존 대화 없이 짧은 시험 요청 하나를 보냅니다.</p></div><button className="text-button" onClick={()=>void api('connection/probe/cancel').catch(e=>setError(e.message))}>응답 확인 취소</button></div>}
    {probe?.status==='ready'&&<div className="probe-result success" role="status"><Check size={18}/><div><b>모델 응답 확인됨 · {((probe.latencyMs||0)/1000).toFixed(1)}초</b><p>{probe.reply}</p><small>{probe.checkedAt?new Date(probe.checkedAt).toLocaleTimeString('ko-KR'):''} 확인 · 이후 네트워크와 계정 사용량에 따라 달라질 수 있어요.</small></div></div>}
    {probe?.status==='failed'&&<p className="connection-problem" role="alert">{probe.message}</p>}
    {probe?.status==='cancelled'&&<p role="status">응답 확인을 취소했습니다. 이미 전송된 요청은 사용량에 반영될 수 있습니다.</p>}
    <div className="speech-ready"><span className={'dot '+(state.provider.localAudio?'green':'')}/><b>한국어 로컬 음성 인식</b><span>{state.provider.localAudio?'준비됨':state.provider.audioError?'다시 준비 필요':state.provider.audioPreparing?'준비 중':'대기 중'}</span></div>
    {state.provider.audioError&&<><p className="field-note">{state.provider.audioError} 방송과 키보드 대화는 계속할 수 있어요.</p><button className="secondary" disabled={pending||state.provider.audioPreparing} onClick={()=>void perform(()=>api('audio/prepare'))}><RefreshCw size={14}/> 음성 인식 다시 준비</button></>}
    {error&&<p role="alert" className="connection-problem">{error}</p>}
  </section>;
}

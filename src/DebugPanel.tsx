import {useEffect,useState} from 'react';
import {api} from './api';

type Config={enabled:boolean;tryNewFeatures:boolean;mode:'append'|'replace';prompt:string};
type Snapshot={config:Config;basePrompt?:string;settings?:unknown;revision?:string};
export function DebugPanel({locked,onSettingsSaved}:{locked:boolean;onSettingsSaved:()=>void}){
  const [view,setView]=useState<Snapshot|null>(null),[config,setConfig]=useState<Config>({enabled:false,tryNewFeatures:false,mode:'append',prompt:''}),[raw,setRaw]=useState(''),[pending,setPending]=useState(false),[error,setError]=useState(''),[notice,setNotice]=useState('');
  useEffect(()=>{let active=true;api<Snapshot>('debug',undefined,'GET').then(value=>{if(active){setView(value);setConfig(value.config);setRaw(JSON.stringify(value.settings,null,2)||'');}}).catch(e=>{if(active)setError(e.message);});return()=>{active=false;};},[]);
  async function saveConfig(next:Config){setPending(true);setError('');setNotice('');try{await api('debug',next,'PUT');const value=await api<Snapshot>('debug',undefined,'GET');setView(value);setConfig(value.config);setRaw(JSON.stringify(value.settings,null,2)||'');setNotice(next.enabled?'디버그 설정을 적용했습니다.':'디버그 모드를 껐습니다. 기본 프롬프트를 사용합니다.');}catch(e){setError(e instanceof Error?e.message:'저장 실패');}finally{setPending(false);}}
  async function saveSettings(){setPending(true);setError('');try{await api('debug/settings',{revision:view?.revision,settings:JSON.parse(raw)},'PUT');onSettingsSaved();}catch(e){setError(e instanceof Error?e.message:'설정 JSON을 확인해주세요.');}finally{setPending(false);}}
  return <div className="debug-panel">
    <p>프롬프트와 평소 편집할 수 없는 관객 성향·이름·유입 설정을 직접 조정합니다. 변경은 이 PC의 현재 프로필에 저장됩니다.</p>
    <fieldset disabled={locked||pending||!view}>
      <label className="debug-toggle"><input type="checkbox" aria-label="디버그 모드" checked={view?.config.enabled||false} onChange={e=>void saveConfig({...config,enabled:e.target.checked})}/> 디버그 모드 사용</label>
      <label className="debug-toggle"><input type="checkbox" aria-label="신규 기능 사용해보기" checked={view?.config.tryNewFeatures||false} onChange={e=>void saveConfig({...config,tryNewFeatures:e.target.checked})}/> 신규 기능 사용해보기</label>
      <p className="field-note">두 설정을 모두 켜면 프리뷰 기능이 활성화됩니다. OBS·실제 채팅, 로컬 모델, 채팅 요약·리액션·읽던 위치 유지, 분위기 프리셋과 고급 편집을 시험할 수 있습니다. 한쪽을 끄면 외부 연결을 종료하고 기본 AI 제공처로 돌아갑니다.</p>
      {view?.config.enabled&&view.config.tryNewFeatures&&<>
        <label className="set-field">프롬프트 적용 방식<select aria-label="디버그 프롬프트 방식" value={config.mode} onChange={e=>setConfig({...config,mode:e.target.value as Config['mode']})}><option value="append">기본 프롬프트에 추가</option><option value="replace">시스템 프롬프트 전체 대체</option></select></label>
        <p className="field-note">전체 대체는 자동 생성되는 성격·기억·훈수 지침까지 바꿉니다. 기본 프롬프트 복사본은 고정된 문장이므로 이후 설정 변경을 자동 반영하지 않습니다. 출력 JSON 형식과 앱의 데이터 검사는 유지됩니다.</p>
        <label className="set-field">사용자 프롬프트<textarea aria-label="디버그 사용자 프롬프트" rows={14} maxLength={60000} spellCheck={false} value={config.prompt} onChange={e=>setConfig({...config,prompt:e.target.value})}/></label>
        <div className="connection-actions"><button className="secondary" onClick={()=>void saveConfig(config)}>프롬프트 적용</button><button className="secondary" onClick={()=>setConfig({...config,mode:'replace',prompt:view.basePrompt||''})}>기본 프롬프트를 편집창에 불러오기</button><button className="text-button" onClick={()=>void saveConfig({...config,mode:'append',prompt:''})}>프롬프트 기본값 복원</button></div>
        <details><summary>자동 생성되는 기본 프롬프트 보기</summary><p className="field-note">현재 저장된 설정의 일반 라이브 기준입니다. 실제 호출에서는 대화 종류와 참여 관객에 따라 달라집니다.</p><pre style={{whiteSpace:'pre-wrap',overflowWrap:'anywhere',maxHeight:320,overflow:'auto'}}>{view.basePrompt}</pre></details>
        <details><summary>잠긴 설정 편집 · 관객 성향과 고급 설정 JSON</summary><p className="field-note">이름·성격·가치관·사교성·숙련도와 유입 설정을 수정할 수 있습니다. 기억 연결을 위해 관객 ID 목록은 유지해야 합니다. 적용 후 설정 창을 닫아 이전 초안이 덮어쓰지 않도록 합니다. 디버그 모드를 꺼도 이 설정 변경은 유지됩니다.</p><label className="set-field">전체 설정 JSON<textarea aria-label="디버그 전체 설정" rows={18} spellCheck={false} value={raw} onChange={e=>setRaw(e.target.value)}/></label><div className="connection-actions"><button className="secondary" onClick={()=>void saveSettings()}>고급 설정 적용</button><button className="text-button" onClick={()=>setRaw(JSON.stringify(view.settings,null,2)||'')}>편집 취소 · 불러온 값</button></div></details>
      </>}
    </fieldset>
    {notice&&<p role="status">{notice}</p>}{error&&<p role="alert" className="settings-error">{error}</p>}
  </div>;
}

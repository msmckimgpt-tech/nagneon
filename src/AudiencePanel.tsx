import {useEffect,useRef,useState} from 'react';
import {Heart,Users,Trash2} from 'lucide-react';
import {api} from './api';
import type {Persona,State} from './types';
import {presenceLabel} from './Discovery';

function ViewerCard({person,state,onError}:{person:Persona;state:State;onError:(text:string)=>void}){
  const member=state.audience.members[person.id];
  const [note,setNote]=useState(member?.note||''),[dirty,setDirty]=useState(false),[pending,setPending]=useState(false),[saved,setSaved]=useState(false);
  useEffect(()=>{if(!dirty)setNote(member?.note||'');},[member?.note,dirty]);
  async function act(path:string,body?:unknown,method?:string){setPending(true);try{await api(path,body,method);return true;}catch(error){onError(error instanceof Error?error.message:'관객 정보 처리 실패');return false;}finally{setPending(false);}}
  return <section className="panel persona-card" aria-label={`${person.name} 관객`}>
    <span className="avatar large" style={{color:person.color,background:person.color+'19'}}>{person.name[0]}</span>
    <span className="status-pill">{person.id===state.settings.managerId?'매니저':presenceLabel(state.audience.presence[person.id])}</span><h2>{person.name}</h2>
    {member?.aliases?.length>0&&<p className="field-note">이전 이름: {member.aliases.map(a=>a.name).join(' → ')}</p>}
    <p>{person.personality||'아직 알아가는 중이에요. 대화를 나누거나 포인트로 관객 수첩을 열어보세요.'}</p>
    {person.profileUnlocked&&<><p>{person.values}</p><span className="status-pill">{member?.origin?.label}</span></>}
    <div className="tags"><span>함께한 방송 {member?.sessions||0}회</span><span>시청 {Math.floor((member?.seconds||0)/60)}분</span></div>
    {!person.profileUnlocked&&<button className="secondary" disabled={pending||!state.settings.pointsEnabled||state.settings.mode!=='live'} onClick={()=>void act('special/unlock',{kind:'profile',personaId:person.id,requestId:crypto.randomUUID()})}><Heart size={15}/> 관객 수첩 열기 · 30P</button>}
    <label>나만의 메모<textarea aria-label={`${person.name} 메모`} maxLength={2000} value={note} onChange={e=>{setNote(e.target.value);setDirty(true);setSaved(false);}} placeholder="닉네임이 바뀌어도 이 관객에게 남는 메모"/></label>
    <div className="feature-buttons"><button className="secondary" disabled={pending||!dirty} onClick={async()=>{if(await act(`audience/${person.id}/note`,{text:note},'PUT')){setDirty(false);setSaved(true);}}}>메모 저장</button><button className="text-button" disabled={pending||person.id===state.settings.managerId} onClick={()=>void act('audience/'+person.id,undefined,'DELETE')}><Trash2 size={14}/> 관객 제거</button></div>
    {saved&&<small role="status">메모를 저장했습니다.</small>}
  </section>;
}
export function AudiencePanel({state,onError}:{state:State;onError:(text:string)=>void}){
  const [pending,setPending]=useState(false),[notice,setNotice]=useState('');
  const id=useRef(sessionStorage.getItem('backseat-arrival-request'));
  const viewers=state.settings.personas.filter(p=>!p.system),price=state.autonomy?.price??50;
  async function meet(){
    setPending(true);setNotice('새로운 관객이 방송을 발견하고 있어요. 이름과 취향은 첫 만남에서 정해집니다.');
    id.current ||= crypto.randomUUID();sessionStorage.setItem('backseat-arrival-request',id.current);
    try{const receipt=await api<{status:string;error?:string}>('audience/arrive',{requestId:id.current});
      if(receipt.status!=='pending'){id.current=null;sessionStorage.removeItem('backseat-arrival-request');}
      setNotice(receipt.status==='completed'?'새로운 관객이 입장했습니다.':receipt.error||'관객을 구성하는 중입니다.');
    }catch(error){setNotice((error instanceof Error?error.message:'만남을 완료하지 못했습니다.')+' 다시 누르면 같은 요청의 결과를 확인합니다.');}finally{setPending(false);}
  }
  return <><section className="panel feature-body acquisition"><div className="panel-heading"><div><Users size={18}/><b>방송에서 만난 사람들</b></div><span>{state.economy.balance}P</span></div>
    <p>오래 방송하다 우연히, 누군가 남긴 핫클립을 통해, 혹은 포인트로 연 첫 만남에서 새로운 관객이 들어옵니다.</p>
    <p className="field-note">이름과 성향을 미리 고를 수 없어요. 함께한 대화로 취향이 달라지거나 스스로 닉네임을 바꾸기도 합니다. 기본 방송 도우미는 관객 수에 포함하지 않습니다.</p>
    <button className="primary" disabled={pending||state.autonomy?.pending||state.busy||!state.running||state.settings.mode!=='live'||!state.settings.pointsEnabled||(!id.current&&state.economy.balance<price)} onClick={()=>void meet()}>{pending||state.autonomy?.pending?'새로운 관객을 만나는 중…':id.current?'지난 만남 결과 확인':`한 명과 첫 만남 · ${price}P`}</button>
    <p className="field-note">실제 AI 방송에서 모델 1회 사용. 생성 실패나 방송 종료 시 반환됩니다. 방송을 켜는 것만으로 새 관객이 보장되지는 않아요.</p>
    {notice&&<p role="status">{notice}</p>}
  </section><div className="persona-grid">{viewers.map(p=><ViewerCard key={p.id} person={p} state={state} onError={onError}/>)}</div>
  {!viewers.length&&<section className="panel feature-body"><h2>아직 만나기 전이에요</h2><p>실제 AI 방송을 시작하고 첫 체험 포인트로 한 명을 만나보세요. 천천히 방송하며 자연 유입을 기다릴 수도 있습니다.</p></section>}</>;
}

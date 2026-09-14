import {Users,ArrowUpRight} from 'lucide-react';
import profiles from '../shared/discovery.json';
import type {DiscoverySettings,State,Persona} from './types';

export const presenceLabel=(status?:string)=>({active:'채팅 참여',lurking:'조용히 시청',away:'자리 비움',waiting:'입장 대기'}[status || ''] || '방송 대기');
export function DiscoveryControls({value,onChange,onAdd,canAdd}:{value:DiscoverySettings;onChange:(value:DiscoverySettings)=>void;onAdd:()=>void;canAdd:boolean}){
  const total=Object.values(value.mix).reduce((sum,n)=>sum+n,0);
  return <section className="discovery-settings"><h3>관객은 어디에서 들어올까요?</h3>
    <p className="field-note">관객들은 저마다 다른 계기로 찾아와요. 같은 곳에서 왔어도 취향과 성격은 다양해요.</p>
    <label className="checkbox"><input type="checkbox" checked={value.enabled} onChange={e=>onChange({...value,enabled:e.target.checked})}/> 새 관객의 입장과 단골의 재방문</label>
    <div className="form-grid"><label>새 입장 간격 (초)<input type="number" min={10} max={600} value={value.arrivalSeconds} onChange={e=>onChange({...value,arrivalSeconds:Number(e.target.value)})}/></label>
    {(Object.keys(profiles) as (keyof typeof profiles)[]).map(key=><label key={key}>{profiles[key].label} · {total?Math.round(value.mix[key]/total*100):0}%<input aria-label={`${profiles[key].label} 유입 비중`} type="range" min={0} max={100} step={5} value={value.mix[key]} onChange={e=>onChange({...value,mix:{...value.mix,[key]:Number(e.target.value)}})}/></label>)}</div>
    <p className="field-note">비중은 새 관객의 방문 동기에 적용돼요. 기존 기억은 유지됩니다. 입장 후보를 모두 만나면 추가 유입은 멈춥니다. 실제 유입 통계가 아닌 연출 설정이며 리허설에서는 적용하지 않아요.</p>
    <button className="secondary" disabled={!canAdd} onClick={onAdd}><Users size={15}/> 새 관객 후보 6명 추가</button>
  </section>;
}
export function newVisitors(count:number,offset:number):Persona[]{
  const names=['옆자리팝콘','맵구경꾼','느긋한오후','리플레이한번','한판만더봄','잠깐들렀어요'];
  return Array.from({length:count},(_,i)=>({id:crypto.randomUUID(),name:names[i%names.length]+(offset+i>5?String(offset+i+1):''),color:['#a89bff','#8bcdd2','#ffbd78'][i%3],role:'viewer',enabled:true,sociability:[.35,.65,.8][i%3],expertise:[.2,.7,.4][i%3],values:['편안한 분위기와 새로운 사람의 환영','근거 있는 의견과 게임의 재미','함께 웃되 상대를 불편하게 하지 않기'][i%3],personality:'새로 방송을 발견한 관객. 자신의 방문 동기와 성격으로 반응한다. 처음부터 채널의 내부 농담을 알거나 오래 본 척하지 않는다. 짧고 자연스럽게 대화한다.'}));
}
export function AcquisitionPanel({state,onSettings}:{state:State;onSettings:()=>void}){
  const pool=state.settings.personas.filter(p=>p.enabled&&p.id!==state.settings.managerId);
  const visited=pool.filter(p=>state.audience.members[p.id]?.sessions>0);
  const attributed=visited.filter(p=>Object.hasOwn(profiles,state.audience.members[p.id]?.origin?.key || ''));
  const waiting=pool.filter(p=>state.audience.presence[p.id]==='waiting').length;
  return <section className="panel acquisition"><div className="panel-heading"><div><Users size={18}/><b>방송을 발견하고, 단골이 되기까지</b></div><button className="text-button" onClick={onSettings}>유입 구성 <ArrowUpRight size={15}/></button></div>
    <p>{state.settings.discovery.enabled?(state.running?`${state.settings.discovery.arrivalSeconds}초마다 후보 1명씩 입장 · 현재 대기 ${waiting}명`:`다음 방송에서 ${state.settings.discovery.arrivalSeconds}초마다 순차 입장 · 관객 후보 ${pool.length}명`):'새 관객 입장 꺼짐 · 초대한 관객이 함께 시작합니다.'}</p>
    <div className="discovery-bars">{Object.entries(profiles).map(([key,profile])=>{const count=attributed.filter(p=>state.audience.members[p.id]?.origin?.key===key).length;return <div key={key}><span>{profile.label}</span><div className="discovery-track"><i style={{width:`${attributed.length?count/attributed.length*100:0}%`}}/></div><b>{count}명</b></div>;})}</div>
    <small>지금까지 만난 AI 관객의 첫 유입 경로입니다. 직접 초대한 기존 관객은 위 분포에서 제외됩니다. 실제 사이트 이용자나 실제 유입 수치가 아닙니다.</small>
  </section>;
}

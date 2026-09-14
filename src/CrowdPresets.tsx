import type {Settings} from './types';
const presets=[
  {id:'quiet',name:'조용히 같이 보기',description:'관망하는 사람이 많고, 천천히 이야기해요.',patch:{crowdStyle:'cozy',chatPace:2,lurkRatio:.65}},
  {id:'friends',name:'친구들과 수다',description:'적당한 속도로 서로 이야기를 받아줘요.',patch:{crowdStyle:'cozy',chatPace:4,lurkRatio:.3}},
  {id:'lively',name:'북적이는 채팅',description:'큰 순간에 여러 관객이 짧게 호응해요.',patch:{crowdStyle:'lively',chatPace:6,lurkRatio:.2}},
  {id:'stadium',name:'응원석 분위기',description:'활발한 공동 반응을 즐겨요.',patch:{crowdStyle:'stadium',chatPace:8,lurkRatio:.1}},
] as const;
export function CrowdPresets({draft,locked,onChange}:{draft:Settings;locked:boolean;onChange:(patch:Partial<Settings>)=>void}){
  return <fieldset className="crowd-presets" disabled={locked}><legend>분위기 빠르게 고르기</legend><p className="muted">관객 규모의 느낌·채팅 속도·관망 비율을 함께 바꿔요. 선택 후 각 항목을 더 조절할 수 있어요.</p><div>{presets.map(p=><button type="button" key={p.id} aria-pressed={draft.crowdStyle===p.patch.crowdStyle&&draft.chatPace===p.patch.chatPace&&draft.lurkRatio===p.patch.lurkRatio} onClick={()=>onChange(p.patch)}><b>{p.name}</b><span>{p.description}</span></button>)}</div></fieldset>;
}

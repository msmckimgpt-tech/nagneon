import {useState} from 'react';
import {api} from './api';
import {TrainingPanel} from './Training';
import type {State} from './types';
export function NaturalExperiences({state,onError}:{state:State;onError:(message:string)=>void}){
  const [practice,setPractice]=useState(false);
  return <div className="experiences"><section className="panel feature-body"><span className="eyebrow">IT STARTS WITH A CONVERSATION</span><h2>방송하다 보면, 이야기가 시작돼요.</h2>
    <p>기념일 이야기에는 작은 축하가, 음악 이야기에는 라디오 같은 대화가, 막힌 게임에는 함께 고민하는 시간이 이어집니다. 따로 무대를 열거나 다음 장면 버튼을 누를 필요가 없어요.</p>
    <p>방송실에서 평소처럼 말해주세요. 관객마다 관심 있는 이야기가 다르고, 쉬고 싶거나 다른 이야기를 하자는 말에도 반응합니다.</p>
    <div className="tags"><span>축하와 기념</span><span>새벽 라디오</span><span>취향 토론</span><span>즉흥 역할극</span><span>게임 도전</span><span>함께한 기억</span></div>
    <p role="status">{state.ambient?.quiet?'지금은 잠시 조용히 함께하는 중':state.ambient?.active?`지금 이어지는 이야기 · ${state.ambient.active.title}`:'새로운 이야기의 계기를 기다려요.'}</p>
  </section>
  {!!state.director.archive.length&&<section className="panel feature-body"><h3>예전에 함께한 방송</h3>{state.director.archive.slice(-10).reverse().map(item=><p key={item.id}><b>{item.title}</b> · {new Date(item.startedAt).toLocaleDateString('ko-KR')} · {item.messageCount}개 대화</p>)}</section>}
  <section className="panel feature-body"><h3>필요할 때 미리 연습하기</h3><p>기기 문제나 어려운 채팅 대응을 따로 연습하고 싶다면 준비된 상황을 사용할 수 있습니다. 실제 방송의 관객과 포인트에는 영향을 주지 않아요.</p><button className="secondary" onClick={()=>setPractice(!practice)}>{practice?'연습 도구 접기':'상황 연습 도구 열기'}</button>
  {(practice||state.training.active)&&<TrainingPanel training={state.training} onAction={async(path,body)=>{try{return await api(path,body);}catch(error){onError(error instanceof Error?error.message:'연습 진행 실패');throw error;}}}/>}</section></div>;
}

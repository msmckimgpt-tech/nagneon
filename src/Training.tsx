import {useState} from 'react';
import {GraduationCap,Target,Play,Send,ListChecks,Shield,Square} from 'lucide-react';
import type {Message} from './types';

// Mirrors server/training.js TrainingRun.snapshot(). Kept in this file so the
// panel is self-contained; the main app wires `training` and `onAction`.
export type TrainingScenario={id:string;title:string;description:string;objective:string};
export type TrainingAction={action:string;text:string;at:number};
export type TrainingReport={
  scenarioId:string;scenarioTitle:string;startedAt:number;endedAt:number;durationMs:number;
  eventsSent:number;participants:number;totalActions:number;actionCounts:Record<string,number>;
  responses:number;moderations:number;checklist:number;reflection:string[];disclaimer:string;
};
export type TrainingState={
  active:boolean;scenario:TrainingScenario|null;catalog:TrainingScenario[];
  startedAt:number|null;eventsSent:number;actions:TrainingAction[];report:TrainingReport|null;messages:Message[];
};

const ACTION_LABELS:Record<string,string>={response:'채팅 응답',checklist:'체크리스트 점검',moderation:'중재·경고'};
const actionLabel=(key:string)=>ACTION_LABELS[key] || key;
const formatDuration=(ms:number)=>{const s=Math.max(0,Math.round(ms/1000));const m=Math.floor(s/60);return m>0?`${m}분 ${s%60}초`:`${s}초`;};

export function TrainingPanel({training,onAction}:{training:TrainingState;onAction:(path:string,body?:unknown)=>Promise<unknown>}){
  const [text,setText]=useState('');
  const [busy,setBusy]=useState(false);
  const run=async(path:string,body?:unknown)=>{
    if(busy)return;setBusy(true);
    try{await onAction(path,body);return true;}catch{return false;}finally{setBusy(false);}
  };
  const record=async()=>{const t=text.trim();if(!t)return;if(await run('training/action',{action:'response',text:t}))setText('');};
  const {active,scenario,report}=training;

  return <>
    <section className="panel info-panel">
      <GraduationCap size={20}/>
      <div>
        <b>방송 리허설</b>
        <p>처음 온 관객 맞이부터 날 선 채팅 대응까지. 준비된 상황을 천천히 연습하세요.</p>
      </div>
    </section>

    {active&&scenario?<>
      <section className="panel teaching">
        <span className="status-pill working">연습 진행 중</span>
        <h2>{scenario.title}</h2>
        <p>{scenario.description}</p>
        <div className="pinned"><Target size={17}/><div><b>이번 연습 목표</b><p>{scenario.objective}</p></div></div>
        <div className="tags"><span>등장한 채팅 {training.eventsSent}개</span><span>기록한 행동 {training.actions.length}개</span></div>
        <div className="training-chat" aria-label="상황 연습 채팅" aria-live="polite">{training.messages.map(m=><p key={m.id}><b style={{color:m.color}}>{m.name}</b> {m.text}</p>)}</div>
        <textarea aria-label="연습 응답 기록" placeholder="이 상황에 어떻게 반응할지 적어보고 기록하세요. (내용은 채점되지 않습니다)" value={text} maxLength={600} onChange={e=>setText(e.target.value)}/>
        <div className="inline-form">
          <button className="primary" disabled={busy||!text.trim()} onClick={()=>void record()}><Send size={15}/> 응답 기록</button>
          <button className="secondary" disabled={busy} onClick={()=>void run('training/action',{action:'checklist',text:''})}><ListChecks size={15}/> 체크리스트 점검</button>
          <button className="secondary" disabled={busy} onClick={()=>void run('training/action',{action:'moderation',text:''})}><Shield size={15}/> 중재·경고 기록</button>
        </div>
      </section>

      <section className="panel event-log">
        <div className="panel-heading"><b>기록한 행동</b><span className="count">{training.actions.length}</span></div>
        {training.actions.length===0&&<p className="muted">응답·체크리스트·중재 기록이 여기에 쌓입니다.</p>}
        {training.actions.slice().reverse().map((a,i)=><div className="event" key={i}><span>{actionLabel(a.action)}</span><p>{a.text||'—'}</p></div>)}
      </section>

      <div className="section-actions">
        <span className="muted">연습을 마치면 관찰된 행동 횟수와 시간, 돌아보기 질문이 정리됩니다.</span>
        <button className="stop-button" disabled={busy} onClick={()=>void run('training/stop',{})}><Square size={14} fill="currentColor"/> 연습 종료</button>
      </div>
    </>:<>
      <div className="section-actions"><span className="muted">상황을 골라 연습을 시작하세요. 관객들의 반응을 보며 나만의 진행 방식을 찾아보세요.</span></div>
      <div className="persona-grid">
        {training.catalog.map(s=><section className="panel persona-card" key={s.id}>
          <span className="status-pill">연습</span>
          <h2>{s.title}</h2>
          <p>{s.description}</p>
          <div className="pinned"><Target size={16}/><div><b>목표</b><p>{s.objective}</p></div></div>
          <button className="secondary" disabled={busy} onClick={()=>void run('training/start',{id:s.id})}><Play size={15} fill="currentColor"/> 연습 시작</button>
        </section>)}
      </div>

      {report&&<section className="panel teaching" style={{marginTop:22}}>
        <span className="status-pill">연습 리포트 · 측정값</span>
        <h2>{report.scenarioTitle}</h2>
        <div className="tags">
          <span>진행 시간 {formatDuration(report.durationMs)}</span>
          <span>등장한 채팅 {report.eventsSent}개</span>
          <span>참여 관객 {report.participants}명</span>
          <span>기록한 행동 {report.totalActions}개</span>
        </div>
        <div className="tags" style={{marginTop:10}}>
          {Object.entries(report.actionCounts).length===0
            ?<span>기록한 행동 없음</span>
            :Object.entries(report.actionCounts).map(([k,v])=><span key={k}>{actionLabel(k)} {v}회</span>)}
        </div>
        <div className="rules">
          <b>돌아보기 · 스스로 점검</b>
          <ul>{report.reflection.map((q,i)=><li key={i}>{q}</li>)}</ul>
        </div>
      </section>}
    </>}
  </>;
}

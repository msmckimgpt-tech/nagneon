import {randomUUID} from 'node:crypto';
import {episodes} from '../shared/episodes.js';
import {Observation} from './schema.js';

const publicEpisode=({stages,...episode})=>({...episode,stages:stages.map(([title])=>title)});
export class Director {
  constructor(studio,{data=[],save=()=>{}}={}){this.studio=studio;this.archive=data;this.save=save;this.active=null;this.serial=0;}
  snapshot(){return {catalog:episodes.map(publicEpisode),active:this.active?structuredClone(this.active):null,archive:this.archive.map(({messages,...item})=>({...item,messageCount:messages.length}))};}
  context(){if(!this.active)return null;const a=this.active;return {id:a.id,title:a.title,premise:a.premise,stage:a.stage,stageTitle:a.stageTitle,fictional:true,cast:a.cast,instruction:'진행 중인 가상 기획 방송의 맥락입니다. 관객의 개성과 의견 차이를 유지하고 스트리머의 새 발언에 반응하세요. 허구의 설정을 실제 게임 관찰이나 과거 기억으로 바꾸지 마세요.'};}
  start({episodeId,premise='',targets}){
    const s=this.studio,episode=episodes.find(e=>e.id===episodeId);
    if(!s.running||s.settings.mode!=='live')throw new Error('AI 방송을 시작한 뒤 기획 방송을 열어주세요.');
    if(this.active)throw new Error('진행 중인 기획 방송을 먼저 마무리하세요.');
    if(s.seasons.active)throw new Error('진행 중인 시즌을 쉬어간 뒤 기획 방송을 열어주세요.');
    if(s.busy)throw new Error('현재 관객 응답이 끝난 뒤 시작하세요.');
    if(!episode)throw new Error('기획 방송을 찾을 수 없습니다.');
    if(typeof premise!=='string'||premise.length>1200)throw new Error('오늘의 설정은 1,200자 이내로 작성하세요.');
    const present=s.settings.personas.filter(p=>p.enabled&&p.id!==s.settings.managerId&&p.role!=='manager'&&['active','lurking'].includes(s.audience.presence[p.id]));
    if(targets&&(!Array.isArray(targets)||new Set(targets).size!==targets.length||targets.some(id=>!present.some(p=>p.id===id))))throw new Error('현재 함께하는 관객을 중복 없이 골라주세요.');
    const cast=(targets?present.filter(p=>targets.includes(p.id)):present.slice(0,6));
    if(!cast.length||cast.length>8)throw new Error('기획 방송에 참여할 관객 1~8명이 필요합니다.');
    this.serial++;this.active={id:randomUUID(),episodeId,title:episode.title,premise:premise.trim(),cast:cast.map(p=>({id:p.id,name:p.name})),sessionId:s.sessionId,sessionStartedAt:s.startedAt,startedAt:s.now(),stage:-1,stageTitle:'개막 준비',totalStages:episode.stages.length,messages:[],choices:[],status:'active'};
    s.log(`기획 방송: ${episode.title}`);s.publish();return this.active;
  }
  record(message){if(this.active){this.active.messages.push({...message});this.active.messages=this.active.messages.slice(-150);}}
  async advance({text=''}={}){
    const s=this.studio,a=this.active;
    if(!a||!s.running)throw new Error('진행 중인 기획 방송이 없습니다.');
    if(s.busy)throw new Error('관객 응답을 기다린 뒤 다음 장면으로 이동하세요.');
    if(typeof text!=='string'||text.length>1200)throw new Error('진행 멘트는 1,200자 이내로 작성하세요.');
    const episode=episodes.find(e=>e.id===a.episodeId),next=a.stage+1;
    if(next>=episode.stages.length)throw new Error('모든 장면이 끝났습니다. 기획 방송을 마무리하세요.');
    const people=s.settings.personas.filter(p=>p.enabled&&a.cast.some(c=>c.id===p.id)&&['active','lurking'].includes(s.audience.presence[p.id]));
    if(!people.length)throw new Error('참여 관객이 잠시 자리를 비웠습니다.');
    const serial=this.serial,epoch=s.epoch; s.reserveCall();s.busy=true;s.publish();
    try{
      const [stageTitle,instruction]=episode.stages[next];
      const result=await s.provider.react({settings:{...s.settings,personas:people,chatPace:Math.min(8,people.length),webSearch:false},history:s.messages,previous:s.observation,speech:text,audience:{members:people.map(p=>({id:p.id,...s.audience.data.members[p.id]}))},special:{kind:'directed-episode',private:false,fictional:true,title:episode.title,premise:a.premise,stageTitle,instruction,choices:a.choices}},s.controller.signal);
      if(serial!==this.serial||epoch!==s.epoch||!s.running)throw new Error('기획 방송이 종료되어 늦은 반응을 취소했습니다.');
      s.tokens+=Number(result.usage?.total_tokens)||0;
      const observation=Observation.parse(result.observation),seen=new Set();
      const messages=observation.messages.filter(m=>people.some(p=>p.id===m.personaId&&p.enabled&&s.settings.personas.some(q=>q.id===p.id&&q.enabled))&&!(m.spoiler&&s.settings.spoilerGuard)&&!s.settings.blockedWords.some(w=>m.text.normalize('NFKC').toLocaleLowerCase().includes(w.normalize('NFKC').toLocaleLowerCase()))).filter(m=>{if(seen.has(m.personaId))return false;seen.add(m.personaId);return true;});
      if(!messages.length)throw new Error('표시할 수 있는 관객 반응이 없습니다. 이 장면을 다시 열 수 있습니다.');
      a.stage=next;a.stageTitle=stageTitle;if(text.trim()){a.choices.push({stage:next,text:text.trim(),at:s.now()});s.addMessage('streamer',text.trim(),'streamer');}
      // Directed output never becomes an observed game fact or a point reward.
      for(const m of messages)s.addMessage(m.personaId,m.text,'chat');
      s.log(`기획 방송 ${next+1}/${episode.stages.length} · ${stageTitle}`);return {ok:true,stage:next};
    }finally{if(epoch===s.epoch)s.busy=false;s.publish();}
  }
  finish(status='completed'){
    const s=this.studio,a=this.active;if(!a)return null;
    if(status==='completed'&&a.stage<a.totalStages-1)throw new Error('남은 장면을 진행하거나 중도 마무리를 선택하세요.');
    const item={...structuredClone(a),endedAt:s.now(),status};const next=[...this.archive,item].slice(-50);
    this.save(next);this.archive=next;this.active=null;this.serial++;s.queue=s.queue.filter(m=>m.episodeId!==a.id);s.log(`기획 방송 ${status==='completed'?'완료':'마무리'} · ${a.title}`);s.publish();return item;
  }
  clip(id){
    const s=this.studio,item=this.archive.find(e=>e.id===id);
    if(!item||!item.messages.length)throw new Error('대화가 기록된 기획 방송을 선택하세요.');
    const c=s.clips.create({title:item.title,game:'Just Chatting · 기획 방송',participants:item.cast,messages:item.messages,scene:`가상 기획 방송: ${item.title}. 설정: ${item.premise||'기본 설정'}. 마지막 장면: ${item.stageTitle}`,sessionId:item.sessionId,startedAt:item.sessionStartedAt,source:'directed-episode',observedAt:item.endedAt,signature:`episode:${item.id}`});s.publish();return c;
  }
}

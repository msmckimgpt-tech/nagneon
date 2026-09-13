import {randomUUID} from 'node:crypto';
import {seasonTemplates,templateFor} from '../shared/seasons.js';
import {SeasonsData,emptySeasons} from './seasons-schema.js';
import {Observation} from './schema.js';
import {liveViewerContext} from './viewer-context.js';
const blankChapter=node=>({node,stage:-1,startedAt:null,endedAt:null,sessionId:null,cast:[],messages:[],lines:[]});
const cleanText=(value,max,label)=>{if(typeof value!=='string'||value.trim().length>max)throw new Error(`${label}은 ${max}자 이내로 작성하세요.`);return value.trim();};
export class StorySeasons {
  constructor(studio,{data=emptySeasons(),save=()=>{}}={}){this.studio=studio;this.data=SeasonsData.parse(data);this.save=save;this.active=null;this.serial=0;this.autoRetryAt=0;}
  commit(next){const valid=SeasonsData.parse(next);this.save(structuredClone(valid));this.data=valid;}
  get(id){const item=this.data.seasons.find(s=>s.id===id);if(!item)throw new Error('시즌을 찾을 수 없습니다.');return item;}
  node(item){return templateFor(item.templateId).nodes.find(n=>n.id===item.chapters.at(-1).node);}
  snapshot(){return {catalog:seasonTemplates.map(({nodes,...t})=>({...t,nodes:nodes.map(({stages,...n})=>({...n,stages:stages.map(([title])=>title)}))})),settings:this.data.settings,active:this.active?structuredClone(this.active):null,proposals:structuredClone(this.data.proposals),seasons:this.data.seasons.map(s=>({...structuredClone(s),chapters:s.chapters.map(c=>({...structuredClone(c),messageCount:c.messages.length,messages:c.messages.slice(-12)}))}))};}
  context(){if(!this.active)return null;const a=this.get(this.active.id),n=this.node(a),c=a.chapters.at(-1);return {id:a.id,title:a.title,premise:a.premise,stage:c.stage,stageTitle:n.stages[c.stage]?.[0]||'개막 준비',fictional:true,cast:this.active.cast,chapter:n.title,recap:a.decisions,instruction:'진행 중인 가상 연속 방송. recap은 선택 기록을 읽은 맥락이며 관객 자신의 목격 증거가 아니다. 관객마다 말투와 취향을 유지하고 현재 발언에 반응한다. 게임 실적이나 실제 외부 행사로 주장하지 않는다.'};}
  make(templateId,title='',premise=''){
    const template=templateFor(templateId);if(!template)throw new Error('시즌 기획을 선택하세요.');
    title=cleanText(title,100,'시즌 이름');premise=cleanText(premise,1200,'시즌 설정');
    if(this.data.seasons.length>=12)throw new Error('시즌 보관함이 가득 찼습니다. 기록을 내보내고 필요 없는 시즌을 삭제하세요.');
    const now=this.studio.now();return {id:randomUUID(),templateId,version:1,title:title||template.title,premise,createdAt:now,updatedAt:now,status:'open',chapters:[blankChapter(template.start)],decisions:[],keepsake:null};
  }
  create({templateId,title='',premise=''}){const item=this.make(templateId,title,premise);this.commit({...this.data,seasons:[...this.data.seasons,item]});this.studio.publish();return structuredClone(item);}
  remove(id){this.get(id);if(this.active?.id===id)throw new Error('시즌을 쉬어간 뒤 삭제하세요.');this.commit({...this.data,seasons:this.data.seasons.filter(s=>s.id!==id),proposals:this.data.proposals.filter(p=>p.seasonId!==id)});this.studio.publish();}
  present(){const s=this.studio;return s.settings.personas.filter(p=>p.enabled&&p.role!=='manager'&&p.id!==s.settings.managerId&&['active','lurking'].includes(s.audience.presence[p.id]));}
  ready(){const s=this.studio;if(!s.running||s.settings.mode!=='live')throw new Error('AI 방송을 시작한 뒤 함께할 수 있어요.');if(s.busy)throw new Error('현재 관객 응답이 끝난 뒤 다시 시도하세요.');if(s.training.active||s.director.active)throw new Error('진행 중인 다른 방송 경험을 마무리하세요.');}
  resume({id,targets}){
    this.ready();if(this.active)throw new Error('현재 시즌을 쉬어간 뒤 다른 회차를 여세요.');const item=this.get(id);if(item.status!=='open')throw new Error('이미 피날레를 마친 시즌입니다.');
    const available=this.present();const ids=targets??available.slice(0,6).map(p=>p.id);
    if(!Array.isArray(ids)||!ids.length||ids.length>8||new Set(ids).size!==ids.length||ids.some(id=>!available.some(p=>p.id===id)))throw new Error('현재 함께하는 관객 1~8명을 선택하세요.');
    const next=structuredClone(this.data),entry=next.seasons.find(s=>s.id===id),c=entry.chapters.at(-1);
    c.startedAt??=this.studio.now();c.sessionId??=this.studio.sessionId;entry.updatedAt=this.studio.now();this.commit(next);
    this.active={id,cast:ids.map(id=>({id,name:available.find(p=>p.id===id).name}))};this.serial++;this.studio.queue=[];this.studio.knowledge.lastSeen=null;this.studio.publish();return this.context();
  }
  pause(){if(!this.active)return;const id=this.active.id;this.active=null;this.serial++;this.studio.queue=this.studio.queue.filter(m=>m.seasonId!==id);this.studio.knowledge.lastSeen=null;this.studio.publish();}
  record(message){if(!this.active)return;const next=structuredClone(this.data),item=next.seasons.find(s=>s.id===this.active.id),c=item.chapters.at(-1);if(c.messages.some(m=>m.id===message.id))return;this.append(c,[message]);item.updatedAt=this.studio.now();this.commit(next);}
  append(chapter,messages){chapter.messages=[...chapter.messages,...messages].slice(-120);for(const m of messages)if(m.personaId!=='streamer'&&!chapter.cast.some(p=>p.id===m.personaId)&&chapter.cast.length<40)chapter.cast.push({id:m.personaId,name:m.name});}
  allowed(observation,people){const s=this.studio,seen=new Set(),present=this.present();return Observation.parse(observation).messages.filter(m=>people.some(p=>p.id===m.personaId)&&present.some(p=>p.id===m.personaId)&&!(m.spoiler&&s.settings.spoilerGuard)&&!s.settings.blockedWords.some(w=>m.text.normalize('NFKC').toLocaleLowerCase().includes(w.normalize('NFKC').toLocaleLowerCase()))).filter(m=>{if(seen.has(m.personaId))return false;seen.add(m.personaId);return true;});}
  async advance({text=''}={}){
    this.ready();if(!this.active)throw new Error('이어갈 회차를 먼저 여세요.');text=cleanText(text,1200,'진행 멘트');
    const s=this.studio,id=this.active.id,item=this.get(id),chapter=item.chapters.at(-1),node=this.node(item),stage=chapter.stage+1;
    if(stage>=node.stages.length)throw new Error('이 회차의 다음 선택을 정해주세요.');const people=this.present().filter(p=>this.active.cast.some(c=>c.id===p.id));if(!people.length)throw new Error('함께할 관객이 없습니다. 쉬어간 뒤 새 출연진으로 이어가세요.');
    const serial=this.serial,epoch=s.epoch;s.reserveCall();s.busy=true;s.publish();
    try{
      const [stageTitle,instruction]=node.stages[stage];
      const result=await s.provider.react({settings:{...s.settings,personas:people,chatPace:people.length,webSearch:false},history:[],previous:null,...liveViewerContext({members:people.map(p=>({id:p.id,...s.audience.data.members[p.id]}))},people,chapter.messages,null,{journal:s.journal,speech:text,sound:s.sound}),speech:text,directed:this.context(),special:{kind:'season-stage',fictional:true,private:false,title:item.title,premise:item.premise,chapter:node.title,chapterPremise:node.premise,stageTitle,instruction,recap:item.decisions,previousChapters:item.chapters.slice(0,-1).map(c=>({title:templateFor(item.templateId).nodes.find(n=>n.id===c.node).title,streamerLines:c.lines,participants:c.cast})),witnesses:chapter.cast}},s.controller.signal);
      if(epoch!==s.epoch||serial!==this.serial||!s.running)throw new Error('회차가 닫혀 늦은 반응을 취소했습니다.');s.tokens+=Number(result.usage?.total_tokens)||0;
      const output=this.allowed(result.observation,people);if(!output.length)throw new Error('표시할 관객 반응이 없습니다. 같은 장면을 다시 열 수 있어요.');
      const messages=[...(text?[s.prepareMessage('streamer',text,'streamer')]:[]),...output.map(m=>s.prepareMessage(m.personaId,m.text))];
      const next=structuredClone(this.data),entry=next.seasons.find(s=>s.id===id),c=entry.chapters.at(-1);c.stage=stage;if(text)c.lines.push({stage,text});this.append(c,messages);entry.updatedAt=s.now();this.commit(next);
      for(const message of messages)s.publishMessage(message);s.log(`시즌 · ${node.title} / ${stageTitle}`);return {ok:true,stage};
    }finally{if(epoch===s.epoch)s.busy=false;s.publish();}
  }
  choose({id,choiceId}){
    const item=this.get(id);if(this.studio.busy)throw new Error('관객의 응답을 기다려주세요.');if(item.status!=='open'||item.chapters.at(-1).stage!==2)throw new Error('이 회차의 세 장면을 먼저 진행하세요.');
    const n=this.node(item),choice=n.choices.find(c=>c.id===choiceId);if(n.choices.length&&!choice)throw new Error('다음 회차로 이어질 선택을 정해주세요.');if(!n.choices.length&&choiceId)throw new Error('피날레에는 다음 선택이 없습니다.');
    const next=structuredClone(this.data),entry=next.seasons.find(s=>s.id===id);entry.chapters.at(-1).endedAt=this.studio.now();entry.updatedAt=this.studio.now();
    if(choice){entry.decisions.push({from:n.id,choice:choice.id,label:choice.label,next:choice.next,at:this.studio.now()});entry.chapters.push(blankChapter(choice.next));}else{entry.status='completed';entry.keepsake=n.keepsake;}
    this.commit(next);if(this.active?.id===id)this.pause();this.studio.publish();return structuredClone(entry);
  }
  clip({id,nodeId}){const item=this.get(id),chapter=item.chapters.find(c=>c.node===nodeId);if(!chapter?.endedAt||!chapter.messages.length)throw new Error('완료한 회차의 대화부터 핫클립에 남길 수 있어요.');const n=templateFor(item.templateId).nodes.find(n=>n.id===nodeId);const clip=this.studio.clips.create({title:`${item.title} · ${n.title}`.slice(0,100),game:'Just Chatting · 가상 시즌',scene:`가상 연속 방송: ${item.title}. ${n.title}. ${item.premise||n.premise}`.slice(0,2000),participants:chapter.cast,messages:chapter.messages,sessionId:chapter.sessionId,startedAt:chapter.startedAt,source:'season-chapter',observedAt:chapter.endedAt,signature:`season:${id}:${nodeId}`});this.studio.publish();return clip;}
  configure({autoProposals}){if(typeof autoProposals!=='boolean')throw new Error('자동 제안 설정을 확인하세요.');this.commit({...this.data,settings:{autoProposals}});this.studio.publish();return this.data.settings;}
  async propose({automatic=false}={}){
    this.ready();if(this.active)throw new Error('시즌을 쉬어간 뒤 다음 기획을 부탁하세요.');const s=this.studio;
    if(this.data.proposals.filter(p=>['suggested','snoozed'].includes(p.status)).length>=6)throw new Error('먼저 도착한 초대장을 살펴주세요.');
    const people=this.present().sort((a,b)=>this.data.proposals.filter(p=>p.personaId===a.id).length-this.data.proposals.filter(p=>p.personaId===b.id).length);
    const candidates=people.map(person=>({person,message:s.messages.slice().reverse().find(m=>(m.personaId===person.id||m.kind==='streamer')&&m.time>=(s.audience.data.members[person.id]?.joinedAt??Infinity))})).filter(c=>c.message);
    if(!candidates.length)throw new Error('현재 관객과 먼저 대화를 나눠주세요. 그 대화에서 다음 기획이 시작됩니다.');
    const {person,message}=candidates[0],source={type:'public-chat',id:message.id,excerpt:message.text.slice(0,600),at:message.time,fictional:!!message.fictional};
    const templateId=/우주|별빛|상상|원정/.test(source.excerpt)?'starlight-v1':/도전|실패|성공|결승|리그|승부/.test(source.excerpt)?'crew-league-v1':'our-room-v1',template=templateFor(templateId);
    // Persist the attempt before consuming a call. Automatic failures never retry every pump.
    if(s.calls>=s.settings.maxCalls)throw new Error('세션 API 호출 한도에 도달했습니다.');
    this.commit({...this.data,lastAttemptAt:s.now(),lastAttemptSession:s.sessionId});s.reserveCall();s.busy=true;const epoch=s.epoch,serial=this.serial;s.publish();
    try{
      const result=await s.provider.react({settings:{...s.settings,personas:[person],chatPace:1,webSearch:false},history:[],previous:null,speech:'이 대화에서 떠오른 다음 방송 기획을 한 가지 제안해주세요.',special:{kind:'audience-proposal',private:true,fictional:true,source,template:{title:template.title,description:template.description},instruction:'source의 공개 발언에 구체적으로 연결해 이 가상 시즌을 열자는 짧은 초대장을 본인 말투로 쓴다. 한 가지 제안만 한다. 이미 외부 행사를 준비하거나 다른 관객과 몰래 합의했다고 만들지 않는다. 스트리머가 거절하거나 미뤄도 괜찮은 제안이다.'}},s.controller.signal);
      if(epoch!==s.epoch||serial!==this.serial||!s.running)throw new Error('방송 상태가 바뀌어 초대장을 취소했습니다.');s.tokens+=Number(result.usage?.total_tokens)||0;
      const output=this.allowed(result.observation,[person])[0];if(!output)throw new Error('표시할 수 있는 초대장이 없습니다.');
      const proposal={id:randomUUID(),personaId:person.id,name:person.name,templateId,text:output.text,source,createdAt:s.now(),status:'suggested',snoozedUntil:0,seasonId:null};
      this.commit({...this.data,proposals:[...this.data.proposals,proposal].slice(-24)});s.log(`${person.name}의 다음 방송 초대장이 도착했어요.`);return structuredClone(proposal);
    }catch(error){if(automatic)s.log(`관객의 자동 기획 제안 보류: ${error.message}`);throw error;}finally{if(epoch===s.epoch)s.busy=false;s.publish();}
  }
  respond({id,action}){
    const p=this.data.proposals.find(p=>p.id===id);if(!p)throw new Error('초대장을 찾을 수 없습니다.');if(!['accept','decline','snooze'].includes(action))throw new Error('초대장 응답을 확인하세요.');
    if(p.status==='accepted'){if(action==='accept')return structuredClone(this.get(p.seasonId));throw new Error('이미 시즌으로 간직한 초대장입니다.');}
    if(p.status==='declined')throw new Error('이미 정리한 초대장입니다.');
    const next=structuredClone(this.data),proposal=next.proposals.find(p=>p.id===id);let season=null;
    if(action==='accept'){season=this.make(p.templateId,'',`${p.name}의 제안: ${p.text}`.slice(0,1200));proposal.status='accepted';proposal.seasonId=season.id;next.seasons.push(season);}else{proposal.status=action==='snooze'?'snoozed':'declined';proposal.snoozedUntil=action==='snooze'?this.studio.now()+86400000:0;}
    this.commit(next);this.studio.publish();return structuredClone(season||proposal);
  }
  maybePropose(){const s=this.studio,now=s.now();if(!this.data.settings.autoProposals||!s.running||s.settings.mode!=='live'||s.busy||s.director.active||this.active||s.training.active||s.queue.length||s.calls>=s.settings.maxCalls||now<this.autoRetryAt||now-this.data.lastAttemptAt<3600000||this.data.lastAttemptSession===s.sessionId||now-s.startedAt<600000||s.messages.length<20||this.data.proposals.filter(p=>['suggested','snoozed'].includes(p.status)).length>=6)return;
    this.autoRetryAt=now+3600000;void this.propose({automatic:true}).catch(error=>{s.lastError=error.message;s.publish();});
  }
}

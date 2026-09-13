import { EventEmitter } from 'node:events';
import { randomUUID } from 'node:crypto';
import { defaults } from '../shared/defaults.js';
import { Settings, Observation } from './schema.js';
import { Knowledge } from './knowledge.js';
import { Audience } from './audience.js';
import { viewerKnowledgeByPersona,liveViewerContext } from './viewer-context.js';
import { Economy } from './economy.js';
import { SpecialFeatures } from './special-features.js';
import { Clips,ClipFeatures } from './clips.js';
import { TrainingRun } from './training.js';
import { Director } from './director.js';
import { StorySeasons } from './seasons.js';
import {SoundScene} from './sound-scene.js';
import { ConversationJournal } from './conversation-journal.js';
import {AudienceAutonomy} from './audience-autonomy.js';
import {Ambient} from './ambient.js';
import {requestsAdvice} from './advice-intent.js';
import {SpeechInbox} from './speech-inbox.js';
import {repeatedChat} from './chat-quality.js';
import {admitTranscriptCorrection} from './transcript-correction.js';

export class Studio extends EventEmitter {
  constructor({provider,settings=defaults,persist=()=>{},world,now=Date.now,random=Math.random,knowledge=new Knowledge(),audience=new Audience(),journal=new ConversationJournal(),economy,clips,directorData=[],saveDirector=()=>{},seasonsData,saveSeasons=()=>{},storageStatus=()=>({warnings:[],recovered:[]})}={}) {
    super();this.provider=provider;this.settings=Settings.parse(settings);this.persist=persist;this.now=now;this.random=random;
    this.storageStatus=storageStatus;this.audience=audience;this.journal=journal;this.knowledge=knowledge;this.running=false;this.messages=[];this.events=[];this.queue=[];this.controller=new AbortController();this.epoch=0;
    this.economy=economy || new Economy(undefined,()=>{},now);this.economy.ensureWallets(this.settings.personas);this.special=new SpecialFeatures(this);
    this.clips=clips||new Clips({now});this.clipFeatures=new ClipFeatures(this,this.clips);
    this.training=new TrainingRun({now});this.trainingMessages=[];this.director=new Director(this,{data:directorData,save:saveDirector});
    this.seasons=new StorySeasons(this,{data:seasonsData,save:saveSeasons});
    this.sound=new SoundScene(this);this.resetCounters(); this.timer=setInterval(()=>this.pump(),250);this.timer.unref();
    this.world=world;this.ambient=new Ambient(this);if(world){world.bind(this);this.autonomy=new AudienceAutonomy(this,world);}
  }
  resetCounters(){this.speechInbox=new SpeechInbox();this.liveReaction=null;this.ambient?.reset();this.sound?.stop();this.calls=0;this.tokens=0;this.busy=false;this.audioBusy=false;this.lastRequest=0;this.lastSpeaker=new Map();this.observation=null;this.lastError='';this.sessionId=null;this.startedAt=null;this.voiceCues=null;this.failures=0;this.retryAt=0;}
  state(){return {ambient:this.ambient.snapshot(),sound:this.sound.snapshot(),journal:this.journal.summary(),storage:this.storageStatus(),settings:this.world?.publicSettings()||this.settings,autonomy:this.autonomy?.snapshot(),training:{...this.training.snapshot(),messages:this.trainingMessages},director:this.director.snapshot(),seasons:this.seasons.snapshot(),clips:this.clips.list(),economy:this.economy.snapshot(this.settings.personas),audience:this.world?.publicAudience()||{...this.audience.data,presence:this.audience.presence},knowledge:Object.values(this.knowledge.entries),running:this.running,sessionId:this.sessionId,startedAt:this.startedAt,messages:this.messages,events:this.events,observation:this.observation,calls:this.calls,tokens:this.tokens,busy:this.busy,lastError:this.lastError,provider:this.provider.status(),queued:this.queue.length};}
  publish(){this.emit('state',this.state());}
  receiveSpeech({id,sessionId,text,source='keyboard'}){
    if(!this.running||sessionId!==this.sessionId)throw new Error('이미 끝난 방송의 발언은 전달할 수 없습니다.');
    const result=this.speechInbox.receive(id,text,()=>this.publishMessage({...this.prepareMessage('streamer',text,'streamer'),...(source==='microphone'?{transcription:{source:'microphone'}}:{})}),source);
    if(!result.duplicate){
      this.queue=this.queue.filter(m=>m.origin!=='live');
      // A screen-only analysis should yield to the person speaking. The live
      // session signal and paid interactions are deliberately left intact.
      if(this.liveReaction&&!this.liveReaction.hasSpeech){this.liveReaction.superseded=true;this.liveReaction.controller.abort();}
    }
    this.publish();return {...result,pending:this.speechInbox.pending.length};
  }
  log(text){this.events.push({id:randomUUID(),time:this.now(),text});this.events=this.events.slice(-60);}
  setChatDisplay(showStreamerMessages){const next=Settings.parse({...this.settings,showStreamerMessages});this.persist(next);this.settings=next;this.publish();return {showStreamerMessages};}
  correctTranscripts(proposals,candidates){let rejected=false;const eligible=new Map(candidates.map(e=>[e.messageId,e]));
    for(const proposal of proposals||[]){const original=eligible.get(proposal.messageId);if(!original)continue;eligible.delete(proposal.messageId);
      if(proposal.text?.trim()===original.text)continue;
      if(!admitTranscriptCorrection(original.text,proposal)){rejected=true;continue;}
      const correction={text:proposal.text.trim(),confidence:proposal.confidence,reason:proposal.reason,at:this.now()};
      try{if(this.journal.annotateTranscription(original.messageId,correction)){const message=this.messages.find(m=>m.id===original.messageId);if(message)message.transcription={source:'microphone',correction};this.speechInbox.annotate(original.messageId,correction.text);this.publish();}else rejected=true;}
      catch(error){this.log('음성 교정 저장을 미뤘습니다. '+error.message);rejected=true;}
    }return {rejected};
  }
  configure(settings){if(this.running||this.training.active||this.busy)throw new Error('방송·연습·관객 응답을 종료한 뒤 설정을 변경하세요.');const next=Settings.parse(this.autonomy?this.autonomy.configure(settings):settings);this.economy.ensureWallets(next.personas);this.persist(next);this.settings=next;this.publish();}
  start(){if(this.training.active)throw new Error('상황 연습을 마친 뒤 방송을 시작하세요.');if(this.running)return;if(this.settings.mode==='live'&&!this.provider.status().configured)throw new Error('방송 설정에서 ChatGPT 계정 또는 선택한 AI 제공처의 연결을 확인하세요.');
    this.controller.abort();this.controller=new AbortController();this.epoch++;this.queue=[];this.messages=[];this.events=[];this.resetCounters();this.running=true;this.sessionId=randomUUID();this.startedAt=this.now();
    try{if(this.settings.mode==='live'){this.audience.start(this.settings,this.now()).forEach(e=>this.log(e));this.autonomy?.start();}}
    catch(error){this.running=false;this.sessionId=null;this.startedAt=null;this.controller.abort();this.lastError=error.message;this.publish();throw error;}
    this.log(this.settings.mode==='live'?'AI 방송 시작':'리허설 시작 · 예시 반응, API 사용 없음');this.publish();}
  stop(){
    this.sound.stop();this.running=false;this.epoch++;this.controller.abort();this.busy=false;this.audioBusy=false;this.queue=[];this.speechInbox.clear();this.knowledge.lastSeen=null;this.ambient?.reset();
    // Storage failure must never keep the live session or its pending model alive.
    for(const [label,save] of [['시즌',()=>this.seasons.pause()],['관객',()=>this.audience.stop()],['시청 시간',()=>this.autonomy?.stop()]]){
      try{save();}catch(error){this.lastError=`${label} 종료 기록 저장 실패: ${error.message}`;this.log(this.lastError);}
    }
    if(this.training.active)this.training.stop();
    try{this.director.finish('interrupted');}catch(error){this.log(`기획 방송 기록 저장 실패: ${error.message}`);this.director.active=null;this.director.serial++;}
    this.log('방송 종료 · 대기 반응 취소');this.publish();
  }
  close(){this.stop();clearInterval(this.timer);}
  prepareMessage(personaId,text,kind='chat') {
    const p=this.settings.personas.find(p=>p.id===personaId);
    return {id:randomUUID(),personaId,name:p?.name || this.settings.streamer,color:p?.color || '#ffffff',text,kind,time:this.now(),...((this.director.active||this.seasons.active)?{fictional:true}:{})};
  }
  publishMessage(msg){
    this.seasons.record(msg);this.messages.push(msg);
    const directed=this.director.context()||this.seasons.context();
    if(this.running&&this.settings.mode==='live')try{this.journal.record(msg,{sessionId:this.sessionId,witnesses:this.presentWitnesses(),title:directed?.title||this.settings.title});}catch(error){this.log(`대화 기억 보관 실패: ${error.message}`);this.lastError='대화는 표시됐지만 기억에 보관하지 못했습니다. '+error.message;}
    if(this.settings.mode==='live')try{this.audience.message(msg.personaId,directed?`[가상 기획 방송: ${directed.title}] ${msg.text}`:msg.text,this.settings);}catch(error){this.log(`관객 기억 저장 실패: ${error.message}`);this.lastError=error.message;}
    this.director.record(msg);this.messages=this.messages.slice(-500);this.publish();return msg;
  }
  addMessage(personaId,text,kind='chat'){return this.publishMessage(this.prepareMessage(personaId,text,kind));}
  moderate(action,id){
    if(action==='delete'){this.journal.forget([id]);this.speechInbox.forget(id);this.messages=this.messages.filter(m=>m.id!==id);this.log('메시지 삭제');}
    if(action==='ban'||action==='unban'){
      const p=this.settings.personas.find(p=>p.id===id);if(!p)throw new Error('관객을 찾을 수 없습니다.');
      if(action==='ban'&&p.id===this.settings.managerId)throw new Error('매니저 변경은 방송 설정에서 할 수 있습니다.');
      const next={...this.settings,personas:this.settings.personas.map(p=>p.id===id?{...p,enabled:action==='unban'}:p)};
      this.persist(next);this.settings=next;this.queue=this.queue.filter(m=>m.personaId!==id);this.log(`${p.name} ${action==='ban'?'차단':'차단 해제'}`);
      if(this.running&&this.settings.mode==='live'){
        if(action==='ban')this.audience.presence[id]='away';
        else if(this.audience.data.members[id]?.joinedAt>=this.startedAt)this.audience.presence[id]='active';
        else if(this.autonomy)this.audience.presence[id]='away';
        else if(this.settings.discovery.enabled)this.audience.presence[id]='waiting';
        else this.log(this.audience.join(p,this.settings,this.now()));
      }
    }
    if(action==='clear'){this.journal.forget(this.messages.map(m=>m.id));this.speechInbox.clear();this.messages=[];this.queue=[];this.log('채팅 비우기');}this.publish();
  }
  accept(observation,observedAt=this.now(),fictional=false,origin='other'){
    const obs=Observation.parse(observation);if(!fictional)this.observation={game:obs.game,scene:obs.scene,confidence:obs.confidence,excitement:obs.excitement,positiveMoment:obs.positiveMoment,at:observedAt};
    let delay=0;
    for(const m of obs.messages.slice(0,this.settings.chatPace)){
      const p=this.settings.personas.find(p=>p.id===m.personaId && p.enabled);
      const blocked=this.settings.blockedWords.some(w=>m.text.normalize('NFKC').toLocaleLowerCase().includes(w.normalize('NFKC').toLocaleLowerCase()));
      const recent=[...this.messages.slice(-60),...this.queue];
      const duplicate=origin==='live'?repeatedChat(m,recent,this.now()):recent.some(x=>x.text===m.text);
      if(!p || blocked || duplicate || (m.spoiler&&this.settings.spoilerGuard)){if(p&&!duplicate)this.log(`매니저: ${p.name} 메시지 보류`);continue;}
      delay+=600+this.random()*1600;
      this.queue.push({...m,origin,createdAt:this.now(),episodeId:this.director.active?.id,seasonId:this.seasons.active?.id,kind:m.kind==='notice'&&p.id===this.settings.managerId?'notice':'chat',due:this.now()+delay});
    }
    this.publish();
  }
  tickAudience(){if(this.settings.mode!=='live')return;const events=this.audience.tick(this.settings,this.now(),this.observation?.excitement || 0);if(events.length){events.forEach(e=>this.log(e));this.publish();}try{this.autonomy?.tick();}catch(error){this.lastError=error.message;}}
  startTraining(id){if(this.running||this.busy)throw new Error('방송과 관객 응답을 종료한 뒤 연습하세요.');this.training.start(id,this.settings.personas.filter(p=>p.id!==this.settings.managerId));this.trainingMessages=[];this.pump();this.publish();return this.state().training;}
  trainingAction(action,text=''){if(!['response','checklist','moderation'].includes(action))throw new Error('연습 행동을 확인하세요.');if(action==='response'&&!text.trim())throw new Error('응답을 입력하세요.');const entry=this.training.action(action,text);if(action==='response')this.trainingMessages.push({id:randomUUID(),personaId:'streamer',name:this.settings.streamer,color:'#ffffff',text:entry.text,kind:'streamer',time:entry.at});this.trainingMessages=this.trainingMessages.slice(-200);this.publish();return entry;}
  stopTraining(){const report=this.training.stop();this.publish();return report;}
  pump(){if(this.training.active){for(const m of this.training.tick()){const p=this.settings.personas.find(p=>p.id===m.personaId);this.trainingMessages.push({...m,id:randomUUID(),name:p?.name||'관객',color:p?.color||'#ffffff',time:this.now()});this.publish();}return;}if(!this.running)return;const now=this.now();this.tickAudience();if(!this.autonomy)this.seasons.maybePropose();const index=this.queue.findIndex(m=>m.due<=now && now-(this.lastSpeaker.get(m.personaId) || 0)>=this.settings.slowModeSeconds*1000);if(index<0)return;
    const [m]=this.queue.splice(index,1);if(!this.settings.personas.some(p=>p.id===m.personaId&&p.enabled))return;this.lastSpeaker.set(m.personaId,now);try{this.addMessage(m.personaId,m.text,m.kind);}catch(error){this.lastError=error.message;this.log(`채팅 기록 저장 실패: ${error.message}`);this.publish();}
  }
  reserveCall(){if(this.calls>=this.settings.maxCalls)throw new Error('세션 API 호출 한도에 도달했습니다. 방송을 종료하고 한도를 확인하세요.');this.calls++;}
  // 요청 캡처 시점의 목격자 스냅샷: 화면을 함께 본 것으로 인정할, 이번 세션에 실제 입장한(joinedAt>=startedAt) active/lurking 관객.
  // 모델 응답이 지연되어 그 사이 입장/이탈이 생겨도 이 스냅샷을 기준으로 목격을 판단한다(늦게 온 관객은 목격자가 아니다).
  presentWitnesses(){if(this.settings.mode!=='live')return [];return this.settings.personas.filter(p=>p.enabled&&['active','lurking'].includes(this.audience.presence[p.id])&&this.audience.data.members[p.id]?.joinedAt>=this.startedAt).map(p=>p.id);}
  async react({image,speech=''}){
    if(!this.running)throw new Error('방송을 먼저 시작하세요.');if(this.busy)return {skipped:'busy'};
    if(this.autonomy?.waiting)return {skipped:'audience-arrival'};
    const speechBatch=speech?{text:speech,ids:[]}:this.speechInbox.batch();speech=speechBatch.text;
    if(this.now()<this.retryAt)return {skipped:'backoff'};
    if(this.now()-this.lastRequest<this.settings.intervalSeconds*1000&&!speech)return {skipped:'interval'};
    if(speech&&this.now()-this.lastRequest<2000)return {skipped:'interval'};
    const epoch=this.epoch,directed=this.director.context()||this.seasons.context(),directorSerial=this.director.serial,seasonSerial=this.seasons.serial;
    const operation={controller:new AbortController(),hasSpeech:!!speech||!!directed,superseded:false};this.liveReaction=operation;
    const signal=AbortSignal.any([this.controller.signal,operation.controller.signal]);
    this.lastRequest=this.now();this.busy=true;this.lastError='';this.publish();
    try{
      if(speech&&!speechBatch.ids.length&&!(this.messages.at(-1)?.kind==='streamer'&&this.messages.at(-1)?.text===speech)){this.queue=this.queue.filter(m=>m.origin!=='live');this.addMessage('streamer',speech,'streamer');}
      if(this.settings.mode==='rehearsal'){
        const lines=speech?['말 들었어요! 오늘은 어떤 플레이 보여줄 건가요?','ㅋㅋㅋ 채팅이랑 얘기하면서 하니까 방송 같네','저도 같이 볼게요 🍿']:['오늘 방송 출석! 다들 어서 와요 👋','팝콘 준비 완료 🍿','오늘은 무슨 게임 하나요?','방장 오늘 텐션 좋은데 ㅋㅋ','이런 편한 분위기 좋다','다들 채팅 규칙 한 번씩 확인해주세요'];
        const active=this.settings.personas.filter(p=>p.enabled);const offset=Math.floor(this.random()*lines.length);
        this.accept({game:'리허설',scene:'예시 채팅 시뮬레이션 · 화면을 분석하지 않습니다.',confidence:0,excitement:0.35,messages:active.slice(0,this.settings.chatPace).map((p,i)=>({personaId:p.id,text:lines[(offset+i)%lines.length],kind:'chat',spoiler:false}))},this.now(),false,'live');
      }else{
        const game=this.settings.games.find(g=>g.id===this.settings.gameId);
        const name=game.id==='auto'?(this.observation?.game || '알 수 없음'):game.name;
        const adviceRequested=requestsAdvice(speech,this.settings.adviceMode);
        this.tickAudience();const audience=this.audience.context(this.settings,speech,this.observation?.excitement || 0);
        const eligiblePersonas=this.settings.personas.filter(p=>audience.eligible.includes(p.id));
        const eligibleSettings={...this.settings,personas:eligiblePersonas};
        const witnesses=this.presentWitnesses(),capturedAt=this.lastRequest;
        const personalContext=liveViewerContext(audience,eligiblePersonas,this.messages,this.observation,{journal:this.journal,speech,sound:this.sound,now:capturedAt});
        const transcriptCandidates=this.settings.contextualTranscription?this.speechInbox.candidates(speechBatch.ids):[];
        const viewerKnowledge=this.settings.category==='just-chatting'?null:viewerKnowledgeByPersona(this.knowledge.get(name,game.popularity),eligiblePersonas,{popularity:game.popularity});
        this.reserveCall();const result=await this.provider.react({settings:eligibleSettings,history:[],previous:null,image,speech,viewerKnowledge,adviceRequested,...personalContext,transcriptCandidates,directed,ambient:this.autonomy&&!directed?this.ambient.context(speech):null,voiceCues:this.voiceCues&&this.now()-this.voiceCues.at<30000?this.voiceCues:null},signal);
        if(epoch!==this.epoch||!this.running)return {skipped:'stopped'};
        this.tokens+=Number(result.usage?.total_tokens)||0;if(operation.superseded)return {skipped:'superseded'};
        if(directed&&(directorSerial!==this.director.serial||seasonSerial!==this.seasons.serial))return {skipped:'episode-ended'};
        const correction=this.correctTranscripts(result.observation.transcriptCorrections,transcriptCandidates);
        if(correction.rejected){this.log('음성 교정의 의미가 불확실해 이 반응을 보류했습니다.');this.speechInbox.acknowledge(speechBatch.ids);return {ok:true,transcriptionNeedsReview:true};}
        this.accept({...result.observation,messages:result.observation.messages.filter(m=>audience.eligible.includes(m.personaId) )},capturedAt,!!directed,directed?'directed':'live');
        const donations=this.economy.reward({observation:result.observation,settings:this.settings,audience:this.audience,hasInput:!!image||!!speech,paid:!!directed});
        for(const d of donations)this.log(`${d.name}의 가상 후원 ${d.amount}P · ${d.reason}`);if(donations.length)this.publish();
        if(this.autonomy&&!directed){
          try{this.autonomy.evolve(result.observation.viewerChanges,speech,witnesses);this.clipFeatures.spectatorPicks(result.observation,{image,speech,witnesses,capturedAt});}catch(error){this.log(`관객 경험 저장 보류: ${error.message}`);}
        }
        if(!this.autonomy&&!directed&&this.settings.autoHighlights&&result.observation.positiveMoment?.positive&&result.observation.positiveMoment.impact>=.8&&result.observation.confidence>=.75&&result.observation.excitement>=.8){
          try{this.clips.create({game:result.observation.game,scene:result.observation.scene,title:result.observation.positiveMoment.reason,participants:this.settings.personas.filter(p=>['active','lurking'].includes(this.audience.presence[p.id])).map(p=>({id:p.id,name:p.name})),messages:this.messages,image,sessionId:this.sessionId,source:'automatic-moment',startedAt:this.startedAt,signature:result.observation.positiveMoment.signature,observedAt:this.lastRequest});this.publish();}catch(error){this.log(`자동 핫클립 저장 보류: ${error.message}`);}
        }
        if(!directed&&this.settings.category!=='just-chatting'&&image&&result.observation.confidence>=0.7){this.knowledge.observe(game.id==='auto'?result.observation.game:game.name,result.observation.scene,capturedAt,game.popularity,witnesses);this.publish();}
      }
      this.speechInbox.acknowledge(speechBatch.ids);this.failures=0;this.retryAt=0;return {ok:true};
    }catch(error){if(operation.superseded&&epoch===this.epoch)return {skipped:'superseded'};if(epoch===this.epoch){this.failures++;this.retryAt=this.now()+Math.min(60000,3000*2**this.failures);this.lastError=error.message;this.log(error.message);}throw error;}
    finally{if(this.liveReaction===operation)this.liveReaction=null;if(epoch===this.epoch){this.busy=false;this.publish();}}
  }
  async transcribe(buffer,mime,requestSignal){
    if(!this.running||this.settings.mode!=='live')throw new Error('음성 인식은 실제 AI 방송에서 사용할 수 있습니다.');
    if(this.audioBusy)throw new Error('이전 음성을 인식하고 있습니다.');if(!this.provider.localSpeech)this.reserveCall();this.audioBusy=true;const epoch=this.epoch;this.publish();
    const signal=requestSignal?AbortSignal.any([this.controller.signal,requestSignal]):this.controller.signal;
    try {const result=await this.provider.transcribe(buffer,mime,signal);if(epoch!==this.epoch||!this.running||signal.aborted)return {text:''};const value=typeof result==='string'?{text:result}:result;if(value.cues)this.voiceCues={...value.cues,at:this.now()};return value;}
    finally{if(epoch===this.epoch){this.audioBusy=false;this.publish();}}
  }
  async reflect(){
    if(this.running||this.busy||this.training.active)throw new Error('방송과 연습 종료 후에 후일담을 만들 수 있습니다.');
    if(!this.messages.length||this.settings.mode!=='live')throw new Error('실제 방송에서 나눈 대화가 먼저 필요합니다.');
    const participants=this.settings.personas.filter(p=>p.enabled&&this.audience.data.members[p.id]?.joinedAt>=this.startedAt);
    if(!participants.length)throw new Error('함께 방송을 본 관객이 없습니다.');
    this.reserveCall();this.busy=true;const epoch=this.epoch;const controller=new AbortController();this.controller=controller;this.publish();
    try{
      const result=await this.provider.react({settings:{...this.settings,personas:participants},history:this.messages,previous:this.observation,speech:'방송을 함께 본 관객들의 짧은 후기를 작성해주세요.',audience:this.audience.data,offStream:true},controller.signal);
      if(epoch!==this.epoch||this.running)return {skipped:'stopped'};
      this.tokens+=Number(result.usage?.total_tokens)||0;
      for(const m of result.observation.messages){const p=participants.find(p=>p.id===m.personaId);if(!p||(m.spoiler&&this.settings.spoilerGuard)||this.settings.blockedWords.some(w=>m.text.includes(w)))continue;
        this.audience.post({id:randomUUID(),name:p.name,personaId:p.id,text:m.text,time:this.now(),kind:'ai'});}
      this.log('방송 후 관객 후기 생성');return {ok:true};
    }finally{if(epoch===this.epoch){this.busy=false;this.publish();}}
  }
}

import {randomUUID} from 'node:crypto';
import {mkdirSync,writeFileSync,renameSync,existsSync,unlinkSync,readdirSync,statSync} from 'node:fs';
import {join,resolve} from 'node:path';
const MAX_STORAGE=500*1024*1024;
export class Clips {
  constructor({data=[],save=()=>{},dir,now=Date.now}={}){this.data=data;this.save=save;this.dir=dir;this.now=now;}
  change(fn){const next=structuredClone(this.data);const value=fn(next);this.save(next);this.data=next;return value;}
  get(id){const clip=this.data.find(c=>c.id===id);if(!clip)throw new Error('핫클립을 찾을 수 없습니다.');return structuredClone(clip);}
  list(){return this.data.map(({comments,messages,...clip})=>({...clip,commenters:[...new Map(comments.filter(c=>!c.deleted&&c.personaId!=='streamer').map(c=>[c.personaId,{id:c.personaId,name:c.name}])).values()],commentCount:comments.length,messageCount:messages.length})).reverse();}
  storageUsed(){if(!this.dir||!existsSync(this.dir))return 0;return readdirSync(this.dir).reduce((n,name)=>{const s=statSync(join(this.dir,name));return n+(s.isFile()?s.size:0);},0);}
  file(id,extension){if(!/^[a-f0-9-]{36}$/.test(id)||!['jpg','png','webm'].includes(extension)||!this.dir)throw new Error('미디어 파일 경로가 올바르지 않습니다.');return join(resolve(this.dir),`${id}.${extension}`);}
  writeMedia(id,extension,buffer){if(this.storageUsed()+buffer.length>MAX_STORAGE)throw new Error('핫클립 저장 공간 500MB에 도달했습니다. 이전 클립을 정리하세요.');const file=this.file(id,extension);mkdirSync(this.dir,{recursive:true});writeFileSync(file+'.tmp',buffer);renameSync(file+'.tmp',file);return file;}
  create({title,game,participants,messages,scene,image,sessionId,source='manual',observedAt,startedAt,signature,creator,audioEligible=false}){
    if(this.data.length>=100)throw new Error('핫클립 100개에 도달했습니다. 이전 클립을 정리하세요.');
    if(signature){const duplicate=this.data.find(c=>c.signature===signature&&this.now()-c.createdAt<3600000);if(duplicate)return duplicate;}
    // 방송 날짜(day)는 클립을 저장한 시각이 아니라 세션이 시작된 시각(startedAt)을 따른다.
    // 자정을 넘긴 뒤 수동 저장하거나, 방송 종료 후 저장해도 방송이 열린 날짜로 기록된다.
    const id=randomUUID(),at=this.now(),broadcastAt=Number.isFinite(startedAt)?startedAt:at,date=new Date(broadcastAt),day=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
    const clip={id,title:title?.trim().slice(0,100)||scene?.slice(0,70)||'함께한 순간',game:game||'Just Chatting',participants,sessionId,createdAt:at,updatedAt:at,startedAt:Number.isFinite(startedAt)?startedAt:null,observedAt:observedAt||at,day,scene:scene||'함께 나눈 대화',source,signature,creator,comments:[],messages:messages.slice(-25),video:false,audio:false,audioEligible:!!audioEligible,thumbnail:null};
    if(image&&this.dir){const extension=image.startsWith('data:image/png')?'png':'jpg';this.writeMedia(id,extension,Buffer.from(image.split(',')[1],'base64'));clip.thumbnail=extension;}
    try{return this.change(data=>{data.push(clip);return clip;});}catch(error){if(clip.thumbnail)try{unlinkSync(this.file(id,clip.thumbnail));}catch{}throw error;}
  }
  video(id,buffer,metadata){return this.recording(id,buffer,{...metadata,kind:'video'});}
  recording(id,buffer,{startedAt,endedAt,hasAudio,kind='video'}){
    const clip=this.get(id);if(clip.video)throw new Error('이미 영상이 연결된 클립입니다.');if(clip.audio)throw new Error('이미 음성이 연결된 클립입니다.');
    if(!['video','audio'].includes(kind)||(kind==='audio'&&hasAudio!==true))throw new Error('음성 클립에는 소리 트랙이 필요합니다.');
    if(!Buffer.isBuffer(buffer)||buffer.length<100||buffer.length>20*1024*1024||buffer.subarray(0,4).toString('hex')!=='1a45dfa3')throw new Error('20MB 이하 WebM 클립을 사용하세요.');
    if(!Number.isFinite(startedAt)||!Number.isFinite(endedAt)||endedAt<=startedAt||endedAt-startedAt>45000||Math.abs(this.now()-endedAt)>120000)throw new Error('최근 45초 이하의 클립만 연결할 수 있습니다.');
    this.writeMedia(id,'webm',buffer);try{return this.change(data=>{const c=data.find(c=>c.id===id);c[kind]=true;c[kind+'StartedAt']=startedAt;c[kind+'EndedAt']=endedAt;c.hasAudio=!!hasAudio;c.updatedAt=this.now();return c;});}catch(error){try{unlinkSync(this.file(id,'webm'));}catch{}throw error;}
  }
  comment(id,{text,name,personaId='streamer',parentId=null,kind='streamer'}){
    if(!text.trim()||text.length>1000)throw new Error('댓글은 1~1,000자로 작성하세요.');
    return this.commentBatch(id,[{text:text.trim(),name,personaId,parentId,kind}])[0];
  }
  // 여러 댓글을 하나의 change()/save로 원자적으로 커밋한다. 클립 부재·부모 삭제·깊이·상한을
  // 커밋 시점에 다시 검증하므로, 하나라도 거부되거나 저장에 실패하면 전부 롤백되어
  // 부분적으로 남은 모델 댓글 묶음이 생기지 않는다.
  commentBatch(id,items){
    if(!items.length)return [];
    return this.change(data=>{
      const c=data.find(c=>c.id===id);if(!c)throw new Error('핫클립을 찾을 수 없습니다.');
      if(c.comments.length+items.length>150)throw new Error('클립당 댓글은 150개까지 남길 수 있습니다.');
      for(const it of items){
        if(!it.text||!it.text.trim()||it.text.length>1000)throw new Error('댓글은 1~1,000자로 작성하세요.');
        if(it.parentId){let p=c.comments.find(x=>x.id===it.parentId),depth=1;if(!p||p.deleted)throw new Error('대댓글 대상이 이 클립에 없습니다.');while(p.parentId){p=c.comments.find(x=>x.id===p.parentId);if(!p||++depth>=4)throw new Error('대댓글은 4단계까지 가능합니다.');}}
      }
      const at=this.now();const created=items.map(it=>{const item={id:randomUUID(),text:it.text.trim(),name:it.name,personaId:it.personaId,parentId:it.parentId||null,kind:it.kind||'ai',at};c.comments.push(item);return item;});
      c.updatedAt=at;return created;
    });
  }
  removeComment(id,commentId){return this.change(data=>{const c=data.find(c=>c.id===id);if(!c)throw new Error('핫클립을 찾을 수 없습니다.');const item=c.comments.find(x=>x.id===commentId);if(item){item.text='삭제된 댓글입니다.';item.deleted=true;c.updatedAt=this.now();}});}
  remove(id){const c=this.get(id);this.change(data=>{data.splice(data.findIndex(c=>c.id===id),1);});for(const ext of [c.thumbnail,c.video||c.audio?'webm':null].filter(Boolean))try{unlinkSync(this.file(id,ext));}catch(error){if(error.code!=='ENOENT')console.error('클립 미디어 정리 실패:',id);}}
}

export class ClipFeatures {
  constructor(studio,clips){this.studio=studio;this.clips=clips;}
  spectatorPicks(observation,{image,speech,witnesses,capturedAt,heardByViewer={},liveSpeech=[]}){
    const s=this.studio;if(!s.running||s.settings.mode!=='live'||!s.settings.autoHighlights)return [];
    const created=[];
    for(const pick of (observation.clipPicks||[]).slice(0,2)){
      const p=s.settings.personas.find(p=>p.id===pick.personaId&&p.enabled&&!p.system&&p.id!==s.settings.managerId);
      if(!p||!witnesses.includes(p.id)||s.settings.blockedWords.some(w=>(pick.title+' '+pick.reason).includes(w)))continue;
      if(pick.soundId&&pick.speechId)continue;
      const spoken=pick.speechId?liveSpeech.find(e=>e.messageId===pick.speechId):null;
      if(pick.speechId&&!spoken)continue;
      const capture=spoken?.source==='microphone'?spoken.capture:null;
      if(capture&&!spoken.hearers?.includes(p.id))continue;
      const sound=pick.soundId?(heardByViewer[p.id]||[]).find(e=>e.id===pick.soundId&&e.source==='system-output'&&!e.silent&&Number.isFinite(e.startedAt)&&Number.isFinite(e.endedAt)&&e.endedAt>e.startedAt&&e.endedAt<=capturedAt&&capturedAt-e.endedAt<30000):null;
      if(pick.soundId&&!sound)continue;
      if(!sound&&!speech&&(!image||observation.confidence<.55))continue;
      const pickedAt=sound?Math.round((sound.startedAt+sound.endedAt)/2):capture?Math.round((capture.startedAt+capture.endedAt)/2):capturedAt;
      const listeners=sound?witnesses.filter(id=>(heardByViewer[id]||[]).some(e=>e.id===sound.id)):capture?witnesses.filter(id=>spoken.hearers.includes(id)):witnesses;
      if(this.clips.data.some(c=>c.creator&&s.now()-c.createdAt<(c.creator.id===p.id?300000:60000)))continue;
      const signature=s.sessionId+':'+pick.signature.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');
      if(this.clips.data.some(c=>c.signature===signature))continue;
      const clip=this.clips.create({title:pick.title,scene:sound||capture?pick.reason:observation.scene,game:observation.game,participants:s.settings.personas.filter(p=>listeners.includes(p.id)&&!p.system).map(p=>({id:p.id,name:p.name})),messages:s.messages.filter(m=>m.time<=pickedAt||m.id===spoken?.messageId),image:sound||capture?undefined:image,audioEligible:!!sound||!!capture,sessionId:s.sessionId,source:'spectator',creator:{id:p.id,name:p.name,reason:pick.reason},signature,startedAt:s.startedAt,observedAt:pickedAt});
      created.push(clip);s.log(`${p.name} 관객이 핫클립을 남겼습니다: ${pick.title}`);
    }if(created.length)s.publish();return created;
  }
  save({title,image}={}){const s=this.studio;if(!s.sessionId||(!s.messages.length&&!s.observation))throw new Error('방송에서 함께한 장면이나 대화가 먼저 필요합니다.');const participants=s.settings.personas.filter(p=>s.audience.data.members[p.id]?.joinedAt>=s.startedAt).map(p=>({id:p.id,name:p.name}));const clip=this.clips.create({title,image,game:s.observation?.game||'Just Chatting',participants,messages:s.messages,scene:s.observation?.scene,sessionId:s.sessionId,source:'manual',startedAt:s.startedAt});s.publish();return clip;}
  async comments({id,parentId,targets}){
    const s=this.studio;
    // 연습(트레이닝) 진행 중에는 실제 모델을 호출하지 않는다. studio.training이 아직 연동되지 않은
    // 경우 optional chaining으로 안전하게 통과한다.
    if(s.training?.active)throw new Error('연습을 종료한 뒤 관객 댓글을 생성하세요.');
    const clip=this.clips.get(id);if(s.busy)throw new Error('관객 응답을 기다린 뒤 다시 시도하세요.');if(s.settings.mode!=='live')throw new Error('실제 AI 관객 모드에서 댓글을 생성하세요.');
    const parent=parentId?clip.comments.find(c=>c.id===parentId&&!c.deleted):null;if(parentId&&!parent)throw new Error('대댓글 대상을 확인하세요.');
    // 대상 검증: 중복 없이, 알려진 활성 관객 1~4명. 비활성/미등록 대상을 조용히 버리지 않고 거부한다.
    if(!Array.isArray(targets)||targets.length<1||targets.length>4)throw new Error('댓글을 남길 관객 1~4명을 선택하세요.');
    if(new Set(targets).size!==targets.length)throw new Error('같은 관객을 중복해서 선택했습니다.');
    const people=targets.map(t=>s.settings.personas.find(p=>p.id===t));
    if(people.some(p=>!p||!p.enabled))throw new Error('활성 관객 중에서 댓글 대상을 선택하세요.');
    if(clip.comments.length+people.length>150)throw new Error('클립의 댓글 공간이 부족합니다.');
    // attended: 이 클립 방송에 실제 참여했는지. false여도 기록을 읽고 댓글을 남길 수 있으나(오프스트림 감상)
    // 그 자리에 있었던 척은 하지 않는다.
    const attendee=new Set((clip.participants||[]).map(p=>p.id));
    const members=people.map(p=>({id:p.id,name:p.name,attended:attendee.has(p.id),...(s.audience.data.members[p.id]||{})}));
    const epoch=s.epoch;if(s.controller.signal.aborted)s.controller=new AbortController();s.reserveCall();s.busy=true;s.publish();
    try{
      const result=await s.provider.react({settings:{...s.settings,personas:people,chatPace:people.length,webSearch:false},history:clip.messages,previous:{game:clip.game,scene:clip.scene},speech:'',offStream:true,audience:{members},special:{kind:'clip-comment',private:false,instruction:'이 핫클립 기록(제목·장면 요약·남은 채팅)을 읽고 댓글을 남긴다. 기록은 캡션과 채팅 기반이며 영상 자체를 재생·분석하지 않는다. 라이브 당시 없던 관객(attended=false)도 기록을 통해 감상할 수 있으나 그 자리에 함께 있었다고 지어내지 않는다. 기록 밖 사건이나 영상의 실제 재생 내용을 안다고 말하지 않는다. 대댓글 대상이 있으면 그 말에 자연스럽게 답한다. 관객마다 하나씩 짧게 작성한다.',clip:{title:clip.title,game:clip.game,scene:clip.scene,comments:clip.comments.slice(-30),replyTo:parent}}},s.controller.signal);
      // 취소/세션 전환이면 아무것도 커밋하지 않는다.
      if(epoch!==s.epoch)throw new Error('방송 상태가 바뀌어 댓글 생성을 취소했습니다.');s.tokens+=Number(result.usage?.total_tokens)||0;
      // 거부 규칙(미허용 관객·중복·스포일러·차단어·빈/과길이)을 통과한 댓글만 묶음으로 모은다.
      const seen=new Set(),batch=[],accepted=[];
      for(const m of result.observation.messages){const p=people.find(p=>p.id===m.personaId);if(!p||seen.has(p.id))continue;const text=(m.text||'').trim();if(!text||text.length>1000)continue;if(m.spoiler&&s.settings.spoilerGuard)continue;if(s.settings.blockedWords.some(w=>text.toLocaleLowerCase().includes(w.toLocaleLowerCase())))continue;
        seen.add(p.id);batch.push({text,name:p.name,personaId:p.id,parentId:parentId||null,kind:'ai'});accepted.push({p,text});}
      if(!batch.length)throw new Error('표시할 수 있는 댓글을 만들지 못했습니다.');
      // 원자적 커밋: 대기 중 클립 삭제·부모 삭제·상한 초과면 전부 롤백된다. 성공 후에만 관객 기억/관계를 갱신한다.
      const created=this.clips.commentBatch(id,batch);
      for(const {p,text} of accepted){s.audience.message(p.id,text,s.settings);const member=s.audience.data.members[p.id];if(member&&parent&&parent.personaId!==p.id&&parent.personaId!=='streamer')member.peers[parent.personaId]=Math.min(20,(member.peers[parent.personaId]||0)+1);}
      s.audience.save(s.audience.data);return {ok:true,count:created.length};
    }finally{if(epoch===s.epoch)s.busy=false;s.publish();}
  }
}

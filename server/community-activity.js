import {createHash,randomUUID} from 'node:crypto';
import {CommunityActivityData,emptyCommunityActivity} from './community-activity-state.js';
import {clipTextSnapshot,clipMessage} from './clip-memory.js';
import {galleryPost} from './community.js';
import {transcriptAnomaly} from './transcript-correction.js';

export const COMMUNITY_HOUR=3600000,COMMUNITY_COOLDOWN=1800000,COMMUNITY_HOURLY_LIMIT=6;
const hash=value=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
const publicPost=raw=>{const {activityReads,...post}=galleryPost(raw);return post;};
// Own comments and votes do not create another reason for the author to visit.
export function communityRevision(kind,raw,viewerId,cache=new Map()){
  let entry=cache.get(raw);
  if(!entry){
    const value=kind==='clip'?clipTextSnapshot(raw):publicPost(raw);
    const {votes,updatedAt,comments=[],...content}=value;
    entry={content:hash({...content,...(kind==='clip'?{video:raw.video,audio:raw.audio,voice:raw.voice,...(raw.video||raw.audio?{perceptionVersion:1}: {})}: {})}),comments:comments.filter(c=>!c.deleted).map(c=>({personaId:c.personaId,hash:hash(c)}))};cache.set(raw,entry);
  }
  return hash({content:entry.content,comments:entry.comments.filter(c=>c.personaId!==viewerId).map(c=>c.hash)});
}
const validText=(s,m)=>typeof m.text==='string'&&m.text.trim()&&m.text.trim().length<=240&&!(m.spoiler&&s.settings.spoilerGuard)&&!s.settings.blockedWords.some(w=>m.text.normalize('NFKC').toLocaleLowerCase().includes(w.normalize('NFKC').toLocaleLowerCase()));

// One cancellable, low priority model slot. It exists only in this app process;
// persisted attempts bound both restart retries and aggregate hourly usage.
export class CommunityActivity {
  constructor(studio){this.s=studio;this.active=null;this.closed=false;this.lastInput=studio.now();this.wakeAt=studio.now()+60000;this.lastError='';}
  data(){return this.s.audience.data.communityActivity||emptyCommunityActivity();}
  snapshot(){return {enabled:this.s.settings.communityActivityEnabled,status:this.active?'reading':this.s.running?'waiting-for-stream':'waiting',nextAt:Math.max(this.wakeAt,this.data().nextAt),lastError:this.lastError};}
  change(edit){const a=this.s.audience,next=structuredClone(a.data);next.communityActivity=structuredClone(this.data());edit(next.communityActivity,next);next.communityActivity=CommunityActivityData.parse(next.communityActivity);a.save(next);a.data=next;}
  interrupt(){this.lastInput=this.s.now();this.active?.controller.abort();}
  async yield(){this.interrupt();await this.active?.promise;}
  close(){this.closed=true;this.interrupt();}
  available(){const s=this.s;return !this.closed&&!this.active&&!s.busy&&!s.audioBusy&&!s.training.active&&!s.liveReaction&&!s.autonomy?.waiting&&!s.queue.length&&!s.speechInbox.pending.length&&s.settings.mode==='live'&&s.settings.communityActivityEnabled&&s.provider.status().configured&&s.now()-Math.max(this.lastInput,s.lastRequest)>=30000;}
  candidates(now){
    const s=this.s,data=this.data(),people=s.settings.personas.filter(p=>p.enabled&&!p.system&&p.id!==s.settings.managerId&&s.audience.data.members[p.id]?.sessions>0),candidates=[];
    const revisions=new Map(),recentSessions=new Set(s.journal.data.entries.filter(e=>!e.fictional&&e.at<=now&&now-e.at<=604800000).slice().reverse().map(e=>e.sessionId));
    const reviewSessions=new Set([...recentSessions].slice(0,25));
    const add=(kind,id,viewer,raw,revision,at)=>{
      const attempts=data.attempts.filter(a=>a.kind===kind&&a.id===id&&a.viewerId===viewer.id);
      if(attempts.some(a=>now-a.at<COMMUNITY_COOLDOWN)||attempts.filter(a=>a.revision===revision).length>=3)return;
      // Preference affects discovery probability, never a forced positive reply.
      const member=s.audience.data.members[viewer.id],familiar=kind==='clip'&&raw.participants.some(p=>p.id===viewer.id);
      const weight=(.25+(viewer.sociability||0)*.5+(member.affinity||0)*.2+(familiar ? .2 : 0))*(1/(1+Math.max(0,now-at)/604800000));
      candidates.push({kind,id,viewer,raw,revision,weight});
    };
    for(const viewer of people){
      for(const [kind,items] of [['clip',s.clips.data],['gallery',s.audience.data.posts]])for(const raw of items){
        if((raw.comments||[]).length>=150||raw.createdAt>now||raw.time>now)continue;
        if(kind==='gallery'&&raw.personaId===viewer.id&&!raw.comments?.some(c=>!c.deleted&&c.personaId!==viewer.id))continue;
        const revision=communityRevision(kind,raw,viewer.id,revisions);
        if(raw.activityReads?.some(r=>r.viewerId===viewer.id&&r.revision===revision))continue;
        add(kind,raw.id,viewer,raw,revision,raw.createdAt??raw.time);
      }
      if(s.audience.data.posts.length>=200)continue;
      const sessions=new Map();
      for(const e of s.journal.data.entries){if(!reviewSessions.has(e.sessionId)||e.fictional||!e.witnesses.includes(viewer.id)||(s.running&&e.sessionId===s.sessionId)||e.at>now||now-e.at>604800000||e.transcription?.source==='microphone'&&transcriptAnomaly(e.text))continue;const rows=sessions.get(e.sessionId)||[];rows.push(e);sessions.set(e.sessionId,rows);}
      for(const [id,rows] of sessions){if(rows.length<3||data.reviews.some(r=>r.sessionId===id&&r.viewerId===viewer.id)||now-rows.at(-1).at<60000)continue;add('review',id,viewer,rows.slice(-30),hash(id+':'+viewer.id),rows.at(-1).at);}
    }
    return candidates;
  }
  tick(){
    const s=this.s,now=s.now(),data=this.data();
    if(!this.available()||now<Math.max(this.wakeAt,data.nextAt,data.clock)||data.attempts.filter(a=>now-a.at<COMMUNITY_HOUR).length>=COMMUNITY_HOURLY_LIMIT)return;
    this.wakeAt=now+30000;
    const candidates=this.candidates(now);if(!candidates.length)return;
    let pick=s.random()*candidates.reduce((n,c)=>n+c.weight,0),target=candidates.at(-1);
    for(const c of candidates){pick-=c.weight;if(pick<0){target=c;break;}}
    const operation={controller:new AbortController(),epoch:s.epoch,promise:null};this.active=operation;
    operation.promise=this.run(target,operation).catch(error=>{if(!operation.controller.signal.aborted){this.lastError=error.message;s.log('관객의 커뮤니티 방문을 미뤘습니다. '+error.message);}}).finally(()=>{if(this.active===operation){this.active=null;if(s.epoch===operation.epoch)s.busy=false;s.publish();}});
  }
  async run(target,operation){
    const s=this.s,{kind,id,viewer,revision}=target,signal=operation.controller.signal;
    const now=s.now();
    // Save before spending; interruption consumes the attempt but creates no read.
    this.change(data=>{data.clock=Math.max(data.clock,now);data.nextAt=now+240000+s.random()*240000;data.attempts=data.attempts.filter(a=>now-a.at<604800000).slice(-299);data.attempts.push({kind,id,viewerId:viewer.id,revision,at:now});});
    s.busy=true;this.lastError='';s.publish();
    const raw=structuredClone(target.raw),post=kind==='gallery'?publicPost(raw):null,reading=kind==='clip'?clipTextSnapshot(raw):null;
    const media=kind==='clip'&&(raw.video||raw.audio)?await s.clipPerception.read(s.clips,raw,signal):null;
    if(signal.aborted||s.epoch!==operation.epoch||this.closed)return;
    s.reserveCall();
    const comments=reading?.comments||post?.comments?.filter(c=>!c.deleted)||[];
    const member=s.audience.data.members[viewer.id];
    const history=kind==='review'?raw.map(e=>clipMessage({...e,time:e.at})):reading?.messages||[];
    const special={kind:kind==='clip'?'clip-comment':kind==='gallery'?'gallery-comment':'community-review',automatic:true,post,clip:reading,
      instruction:'관객이 스스로 들른 가상 커뮤니티다. 내용을 읽고 본인 취향에 따라 아무것도 쓰지 않거나 짧은 댓글 하나만 쓴다. 침묵도 정상이며 억지 칭찬이나 질문으로 끝내지 않는다. communityVotes는 글/클립 추천 여부이며 댓글과 독립적으로 판단한다. 답글이면 messages의 replyTo에 제공된 댓글 id를 지정하고 새 댓글/후기는 null이다. 읽지 않은 댓글이나 과거 방송을 안다고 지어내지 않는다. 후기는 history에 실제 목격한 대화만 있으며 분석 보고서 대신 한국어 갤러리의 편한 말투로 쓴다. 클립은 현재 제공된 캡션과 채팅 기록을 읽으며 영상이나 소리를 재생했다고 주장하지 않는다. 외부 웹사이트에 글을 썼다고 말하지 않는다.'};
    if(media){special.clipMedia=media.context;special.instruction=special.instruction.replace('클립은 현재 제공된 캡션과 채팅 기록을 읽으며 영상이나 소리를 재생했다고 주장하지 않는다.','클립은 clipMedia에 담긴 실제 시간순 장면과 소리 인식 결과를 참고해 감상한다.');}
    const result=await s.provider.react({settings:{...s.settings,personas:[viewer],chatPace:1,webSearch:false},history:history.map(({at,...m})=>({...m,time:at})),previous:reading?{game:reading.game,scene:reading.scene}:null,frames:media?.frames||[],speech:'',offStream:true,special,audience:{members:[{...member,id:viewer.id,name:viewer.name,attended:kind==='review'||!!raw.participants?.some(p=>p.id===viewer.id)}]}},signal);
    if(signal.aborted||s.epoch!==operation.epoch||this.closed)return;
    s.tokens+=Number(result.usage?.total_tokens)||0;
    if(media){await s.clipPerception.assertCurrent(s.clips,id,media,signal);if(signal.aborted||s.epoch!==operation.epoch||this.closed)return;}
    const current=s.settings.personas.find(p=>p.id===viewer.id&&p.enabled&&!p.system);if(!current||!s.audience.data.members[viewer.id]?.sessions)return;
    let m=result.observation.messages.find(m=>m.personaId===viewer.id&&validText(s,m));
    let parentId=m?.replyTo||null;
    if(parentId){const parent=comments.find(c=>c.id===parentId&&!c.deleted);if(!parent)m=undefined;else if(kind==='gallery')parentId=parent.parentId||parent.id;else{let depth=1,p=parent;while(p.parentId){p=comments.find(c=>c.id===p.parentId);if(!p||++depth>=4){m=undefined;break;}}}}
    if(m&&comments.some(c=>c.personaId===viewer.id&&c.text.trim()===m.text.trim()))m=undefined;
    const vote=result.observation.communityVotes?.find(v=>v.personaId===viewer.id);
    const read={viewerId:viewer.id,revision,at:s.now()};
    if(kind==='clip'){
      this.s.clips.commentBatch(id,m?[{text:m.text,name:current.name,personaId:viewer.id,parentId,kind:'ai'}]:[],{reading,readers:[viewer.id],activityRead:read,votes:vote?[vote]:[],mediaReading:media?{version:1,signature:media.signature,readAt:s.now(),frameTimes:media.context.frameTimes,audio:media.context.audio,scene:result.observation.confidence>=.5?result.observation.scene:''}:undefined});
    }else if(kind==='gallery'){
      s.community.addComments(id,m?[{text:m.text,name:current.name,personaId:viewer.id,parentId,kind:'ai'}]:[],JSON.stringify(post),vote?[vote]:[],read);
    }else{
      const entries=new Map(s.journal.data.entries.map(e=>[e.id,e]));
      if(raw.some(e=>!entries.has(e.id)||hash(entries.get(e.id))!==hash(e)))return;
      this.change((data,next)=>{
        if(data.reviews.some(r=>r.sessionId===id&&r.viewerId===viewer.id))return;
        if(m){if(next.posts.length>=200)throw Error('갤러리 보관 공간이 부족합니다.');next.posts.push({id:randomUUID(),title:m.text.split('\n')[0].slice(0,70),text:m.text.trim(),name:current.name,personaId:viewer.id,time:s.now(),kind:'ai',category:'후기',comments:[],votes:[]});}
        data.reviews=[...data.reviews,{sessionId:id,viewerId:viewer.id,at:s.now()}].slice(-1000);
      });
    }
    s.publish();
  }
}

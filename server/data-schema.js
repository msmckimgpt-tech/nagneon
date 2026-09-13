import {z} from 'zod';
import {ArrivalClipReading} from './arrival-clip-memory.js';
const number=z.number().finite().nonnegative(),time=number.max(8.64e15),id=z.string().min(1).max(100),text=z.string();
const obj=shape=>z.object(shape).passthrough();
const actor=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).refine(v=>!['__proto__','constructor','prototype'].includes(v));
const note=obj({id,text,at:time});
// 관찰 장면에는 캡처 시점 목격자(active/lurking) 스냅샷을 남긴다. provenance 없는 레거시 기록은
// witnesses 가 없으며(=undefined) 개인 목격으로 승격하지 않는다. 목격자 키는 actor 규칙으로 프로토타입 오염을 막는다.
const observationNote=obj({id,text,at:time,witnesses:z.array(actor).max(40).optional()});
const message=obj({id,personaId:id,name:text,text,kind:text,time:time});
// watched: 관객별 개인 시청 초. 게임별 엔트리에 저장되어 재시작 후에도 유지된다. 키는 actor 로 제한해 성장/오염을 막는다.
export const KnowledgeData=z.record(text,obj({name:text,seconds:number,observations:z.array(observationNote),notes:z.array(note),watched:z.record(actor,number).optional()}));
export const AudienceData=obj({members:z.record(actor,obj({sessions:number.int(),seconds:number,recognized:number.int(),affinity:number.max(1),peers:z.record(actor,number),memories:z.array(text),joinedAt:time.optional(),arrivalClip:ArrivalClipReading.optional()})),lore:z.array(obj({text,expiresAt:time})),posts:z.array(obj({id,name:text,text,time:time,kind:text}))});
const purchase=obj({id,kind:z.enum(['profile','relations','thought','interview','contract','arrival']),key:text,cost:number.int(),status:z.enum(['pending','completed','failed']),at:time,fingerprint:text,shares:z.record(actor,number.int()).optional()});
export const EconomyData=obj({version:z.literal(1),balance:number.int(),wallets:z.record(actor,obj({balance:number.int().max(200),refillAt:time,lastDonationAt:time,paidUntil:time})),ledger:z.array(obj({id,at:time,kind:text,amount:z.number().finite(),text,anonymous:z.boolean().optional(),personaId:actor.optional(),name:z.string().max(100).optional()})),purchases:z.array(purchase),quotes:z.array(obj({id,sessionId:id,targets:z.array(actor),kind:text,text,ask:number,floor:number,round:number,status:text,expiresAt:time,history:z.array(obj({speaker:text,text}))})),moments:z.array(obj({fingerprint:text,at:time,amount:number})),rewardBlockedUntil:time,lastRewardAt:time}).superRefine((value,ctx)=>{
  for(const p of value.purchases)if(p.kind==='contract'&&p.status==='pending'&&(!p.shares||Object.values(p.shares).reduce((a,b)=>a+b,0)!==p.cost))ctx.addIssue({code:'custom',message:'협상 보관 포인트 기록이 맞지 않습니다.'});
});
const comment=obj({id,name:text,personaId:id,text,parentId:id.nullable(),at:time,kind:text,deleted:z.boolean().optional()});
const clipSourceRef=z.object({id,hash:z.string().regex(/^[a-f0-9]{64}$/)}).strict();
const clipReading=z.object({viewerId:actor,readAt:time,metadataHash:z.string().regex(/^[a-f0-9]{64}$/),messages:z.array(clipSourceRef).max(25),comments:z.array(clipSourceRef).max(150)}).strict();
export const ClipsData=z.array(obj({id:z.string().uuid(),title:text,game:text,day:text,participants:z.array(obj({id,name:text})),sessionId:id,createdAt:time,updatedAt:time,scene:text,source:text,comments:z.array(comment),messages:z.array(message),readings:z.array(clipReading).max(150).optional(),video:z.boolean(),audio:z.boolean().optional().default(false),audioEligible:z.boolean().optional().default(false),audioStartedAt:time.optional(),audioEndedAt:time.optional(),thumbnail:z.enum(['png','jpg']).nullable()})).superRefine((clips,ctx)=>{
  if(new Set(clips.map(c=>c.id)).size!==clips.length)ctx.addIssue({code:'custom',message:'중복된 핫클립 ID입니다.'});
  for(const c of clips){
    const readers=c.readings||[];if(new Set(readers.map(r=>r.viewerId)).size!==readers.length)ctx.addIssue({code:'custom',message:'중복된 클립 읽기 기록입니다.'});
    for(const r of readers)for(const [refs,sources] of [[r.messages,c.messages],[r.comments,c.comments]]){const ids=new Set(sources.map(m=>m.id));if(new Set(refs.map(m=>m.id)).size!==refs.length||refs.some(m=>!ids.has(m.id)))ctx.addIssue({code:'custom',message:'클립 읽기 기록의 원문 연결을 확인하세요.'});}
    if(c.audio&&(c.video||c.hasAudio!==true||!Number.isFinite(c.audioStartedAt)||!Number.isFinite(c.audioEndedAt)||c.audioEndedAt<=c.audioStartedAt||c.audioEndedAt-c.audioStartedAt>45000))ctx.addIssue({code:'custom',message:'음성 클립의 트랙과 시간을 확인하세요.'});const byId=new Map(c.comments.map(m=>[m.id,m]));if(byId.size!==c.comments.length)ctx.addIssue({code:'custom',message:'중복된 댓글 ID입니다.'});for(const m of c.comments){let p=m,depth=0;const seen=new Set([m.id]);while(p.parentId){p=byId.get(p.parentId);if(!p||seen.has(p.id)||++depth>=4){ctx.addIssue({code:'custom',message:'대댓글 연결 기록을 확인하세요.'});break;}seen.add(p.id);}}}
});
export const EpisodesData=z.array(obj({id:z.string().uuid(),episodeId:id,title:text,premise:text,cast:z.array(obj({id,name:text})),sessionId:id,sessionStartedAt:time,startedAt:time,endedAt:time,stage:z.number().int().min(-1),stageTitle:text,totalStages:number.int(),messages:z.array(message),choices:z.array(obj({stage:number.int(),text,at:time})),status:z.enum(['completed','interrupted'])}));

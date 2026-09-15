import {z} from 'zod';
// Immutable topology validates saved stories only; no stage prompts or runtime engine.
import versions from './legacy-season-versions.json' with {type:'json'};
const templateFor=id=>versions.find(v=>v.id===id);
const time=z.number().finite().nonnegative().max(8.64e15),id=z.string().uuid();
const actor=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).refine(v=>!['__proto__','constructor','prototype'].includes(v));
const cast=z.array(z.object({id:actor,name:z.string().max(100)})).max(40);
const message=z.object({id,personaId:actor,name:z.string().max(100),color:z.string().max(40),text:z.string().max(3000),kind:z.string().max(30),time,fictional:z.boolean().optional()});
const chapter=z.object({node:z.string().max(40),stage:z.number().int().min(-1).max(2),startedAt:time.nullable(),endedAt:time.nullable(),sessionId:id.nullable(),cast,messages:z.array(message).max(120),lines:z.array(z.object({stage:z.number().int().min(0).max(2),text:z.string().max(1200)})).max(3)});
const season=z.object({id,templateId:z.string().max(60),version:z.literal(1),title:z.string().min(1).max(100),premise:z.string().max(1200),createdAt:time,updatedAt:time,status:z.enum(['open','completed']),chapters:z.array(chapter).min(1).max(8),decisions:z.array(z.object({from:z.string().max(40),choice:z.string().max(40),label:z.string().max(100),next:z.string().max(40),at:time})).max(7),keepsake:z.string().max(100).nullable()});
const proposal=z.object({id,personaId:actor,name:z.string().max(100),templateId:z.string().max(60),text:z.string().min(1).max(3000),source:z.object({type:z.literal('public-chat'),id,excerpt:z.string().max(600),at:time,fictional:z.boolean()}),createdAt:time,status:z.enum(['suggested','snoozed','declined','accepted']),snoozedUntil:time,seasonId:id.nullable()});
export const emptySeasons=()=>({version:1,settings:{autoProposals:false},lastAttemptAt:0,lastAttemptSession:null,seasons:[],proposals:[]});
export const SeasonsData=z.object({version:z.literal(1),settings:z.object({autoProposals:z.boolean()}),lastAttemptAt:time,lastAttemptSession:id.nullable(),seasons:z.array(season).max(12),proposals:z.array(proposal).max(24)}).superRefine((data,ctx)=>{
  const fail=message=>ctx.addIssue({code:'custom',message});
  if(new Set(data.seasons.map(s=>s.id)).size!==data.seasons.length||new Set(data.proposals.map(p=>p.id)).size!==data.proposals.length)fail('시즌 또는 초대장 ID가 중복되었습니다.');
  for(const s of data.seasons){
    const t=templateFor(s.templateId);if(!t||t.version!==s.version){fail('지원하지 않는 시즌 판본입니다.');continue;}
    if(s.chapters[0].node!==t.start||s.decisions.length!==s.chapters.length-1)fail('시즌의 시작 또는 선택 기록이 맞지 않습니다.');
    const ids=new Set();
    for(let i=0;i<s.chapters.length;i++){
      const c=s.chapters[i],n=t.nodes.find(n=>n.id===c.node);if(!n||ids.has(c.node)){fail('시즌 회차 연결이 맞지 않습니다.');continue;}ids.add(c.node);
      if(new Set(c.messages.map(m=>m.id)).size!==c.messages.length||new Set(c.cast.map(p=>p.id)).size!==c.cast.length)fail('회차의 중복 기록입니다.');
      if((c.endedAt!==null&&c.stage!==2)||(i<s.chapters.length-1&&c.endedAt===null))fail('완료되지 않은 회차가 연결되었습니다.');
      if(i<s.chapters.length-1){const d=s.decisions[i],link=n.choices.find(x=>x.id===d?.choice);if(d?.from!==c.node||link?.next!==s.chapters[i+1].node||d?.next!==link?.next||d?.label!==link?.label)fail('선택한 다음 회차가 맞지 않습니다.');}
    }
    const last=s.chapters.at(-1),node=t.nodes.find(n=>n.id===last.node);
    if(s.status==='completed'&&(!node||node.choices.length||last.endedAt===null||s.keepsake!==node.keepsake))fail('시즌 피날레 기록이 맞지 않습니다.');
    if(s.status==='open'&&(last.endedAt!==null||s.keepsake!==null))fail('진행 중인 시즌 상태가 맞지 않습니다.');
  }
  for(const p of data.proposals)if(!templateFor(p.templateId)||(p.status==='accepted'?!data.seasons.some(s=>s.id===p.seasonId):p.seasonId!==null))fail('초대장 연결이 맞지 않습니다.');
});

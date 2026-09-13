import {z} from 'zod';
import {randomUUID} from 'node:crypto';
import {Settings} from './schema.js';
import {AudienceData,EconomyData} from './data-schema.js';
const actor=z.string().regex(/^[a-zA-Z0-9_-]{1,40}$/).refine(v=>!['__proto__','constructor','prototype'].includes(v));

// Roster, relationship state and point settlement share one JsonStore rename.
// Legacy files are inputs to the first migration only; they remain untouched.
export const WorldData=z.object({
  version:z.literal(1),settings:Settings,audience:AudienceData,economy:EconomyData,
  autonomy:z.object({
    retired:z.record(z.string(),z.unknown()).default({}),
    unlocks:z.record(actor,z.object({profile:z.boolean().optional(),relations:z.boolean().optional()})).default({}),
    receipts:z.record(z.string().uuid(),z.object({status:z.enum(['pending','completed','failed']),cost:z.number().int().nonnegative(),at:z.number(),source:z.object({path:z.enum(['points','broadcast','clip']),key:z.string(),label:z.string(),clipId:z.string().optional()}),personaId:z.string().optional(),error:z.string().optional()})).default({}),
    broadcastSeconds:z.number().nonnegative().default(0),lastArrivalAt:z.number().nonnegative().default(0)
  })
}).superRefine((value,ctx)=>{
  for(const [id,member] of Object.entries(value.audience.members)){
    const reading=member.arrivalClip;if(!reading)continue;
    const receipt=value.autonomy.receipts[reading.receiptId];
    if(!receipt||receipt.status!=='completed'||receipt.personaId!==id||receipt.source.path!=='clip'||receipt.source.clipId!==reading.clipId||member.origin?.path!=='clip'||member.origin?.clipId!==reading.clipId||receipt.at>reading.receivedAt)
      ctx.addIssue({code:'custom',message:'클립 유입 기억과 관객 생성 기록이 일치하지 않습니다.',path:['audience','members',id,'arrivalClip']});
  }
});
export function migrateWorld(settings,audience,economy,{fresh=false}={}){
  const next=structuredClone({version:1,settings,audience,economy,autonomy:{retired:{},receipts:{},broadcastSeconds:0,lastArrivalAt:0}});
  if(fresh){
    const manager=next.settings.personas.find(p=>p.id===next.settings.managerId);
    next.settings.personas=[{...manager,name:'방송 도우미',system:true,personality:'방송 규칙을 관리하는 기본 도우미. 시청자나 단골 행세를 하지 않는다.'}];
  }else{
    // Unmet legacy candidates are archived, never queued for future admission.
    next.settings.personas=next.settings.personas.filter(p=>{
      if(p.id===next.settings.managerId||next.audience.members[p.id]?.sessions>0)return true;
      next.autonomy.retired[p.id]={persona:p,reason:'legacy-unmet'};return false;
    });
    const manager=next.settings.personas.find(p=>p.id===next.settings.managerId);
    if(!next.audience.members[manager.id]?.sessions)manager.system=true;
  }
  return WorldData.parse(next);
}
export class World {
  constructor(data,save=()=>{}){this.data=WorldData.parse(data);this.save=save;this.studio=null;}
  bind(studio){this.studio=studio;studio.audience.autonomous=true;}
  snapshot(){const s=this.studio;return s?{...this.data,settings:s.settings,audience:s.audience.data,economy:s.economy.data}:this.data;}
  change(fn){const next=structuredClone(this.snapshot());
    const preserveGrants=()=>{next.autonomy.unlocks ||= {};for(const p of next.economy.purchases)if(p.status==='completed'&&['profile','relations'].includes(p.kind)&&p.key.startsWith(p.kind+':')){const id=actor.parse(p.key.slice(p.kind.length+1));(next.autonomy.unlocks[id] ||= {})[p.kind]=true;}};
    preserveGrants();const result=fn(next);preserveGrants();const validated=WorldData.parse(next);this.save(validated);this.data=validated;
    if(this.studio){this.studio.settings=validated.settings;this.studio.audience.data=validated.audience;this.studio.economy.data=validated.economy;}return result;
  }
  part(key,value){this.change(d=>{d[key]=value;});}
  recover(){
    if(!this.data.economy.purchases.some(p=>p.status==='pending'))return;
    this.change(d=>{for(const p of d.economy.purchases.filter(p=>p.status==='pending')){
      d.economy.balance+=p.cost;p.status='failed';p.error='앱 재시작으로 취소되어 포인트를 반환했습니다.';
      const receipt=d.autonomy.receipts[p.id];if(receipt){receipt.status='failed';receipt.error=p.error;}
      const quote=d.economy.quotes.find(q=>q.id===p.key);if(quote)quote.status='failed';
      d.economy.ledger.push({id:randomUUID(),at:Math.max(Date.now(),d.economy.timeFloor||0),kind:'refund',amount:p.cost,text:p.error});
    }});
  }
  revealed(id,kind){return !!this.data.autonomy.unlocks[id]?.[kind]||this.snapshot().economy.purchases.some(p=>p.kind===kind&&p.key===`${kind}:${id}`&&p.status==='completed');}
  publicSettings(){const settings=this.snapshot().settings;return {...settings,personas:settings.personas.map(p=>{
    const {id,name,color,role,enabled,system}=p;
    return {id,name,color,role,enabled,system,...(this.revealed(id,'profile')?{personality:p.personality,values:p.values,sociability:p.sociability,expertise:p.expertise}:{}),profileUnlocked:this.revealed(id,'profile')};
  })};}
  publicAudience(){const s=this.studio;return {lore:s.audience.data.lore,posts:s.audience.data.posts,presence:s.audience.presence,
    members:Object.fromEntries(s.settings.personas.map(p=>{const m=s.audience.data.members[p.id];return [p.id,m?{
      sessions:m.sessions,seconds:m.seconds,joinedAt:m.joinedAt,note:m.note||'',aliases:m.aliases||[],
      ...(this.revealed(p.id,'profile')?{origin:m.origin,recognized:m.recognized,affinity:m.affinity}:{}),
      ...(this.revealed(p.id,'relations')?{peers:m.peers}:{})
    }:{sessions:0,seconds:0,note:'',aliases:[]}];}))};}
}

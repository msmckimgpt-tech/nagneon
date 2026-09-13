import {randomUUID,createHash} from 'node:crypto';
import {z} from 'zod';
import profiles from '../shared/discovery.json' with {type:'json'};
import {Persona} from './schema.js';

export const ARRIVAL_PRICE=50;
const blankMember=()=>({sessions:0,seconds:0,recognized:0,affinity:.15,peers:{},memories:[],note:'',aliases:[]});
const normalized=s=>s.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');
export class AudienceAutonomy {
  constructor(studio,world){this.studio=studio;this.world=world;this.lastTick=0;this.nextCheck=0;this.lastSaved=0;this.seconds=world.data.autonomy.broadcastSeconds;this.pending=null;}
  start(){this.lastTick=this.studio.now();this.lastSaved=this.lastTick;this.nextCheck=this.lastTick+60000;}
  stop(){if(this.seconds!==this.world.data.autonomy.broadcastSeconds)this.world.change(d=>{d.autonomy.broadcastSeconds=this.seconds;});}
  snapshot(){return {pending:!!this.pending,price:ARRIVAL_PRICE,broadcastSeconds:Math.floor(this.seconds),maxViewers:39};}
  configure(input){
    const s=this.studio;
    // Old clients may echo the public roster, but cannot use it as a write API.
    if(input.personas!==undefined&&JSON.stringify(input.personas)!==JSON.stringify(this.world.publicSettings().personas)&&JSON.stringify(input.personas)!==JSON.stringify(s.settings.personas))throw new Error('관객은 직접 추가하거나 성향·이름을 설정할 수 없습니다.');
    const next={...input,personas:s.settings.personas,discovery:s.settings.discovery};
    if(!s.settings.personas.some(p=>p.id===next.managerId&&p.enabled&&(p.system||s.audience.data.members[p.id]?.sessions)))throw new Error('이미 만난 관객 중에서 매니저를 임명하세요.');
    return next;
  }
  note(id,text){
    const s=this.studio;if(typeof text!=='string'||text.length>2000)throw new Error('관객 메모는 2,000자까지 적을 수 있습니다.');
    if(!s.settings.personas.some(p=>p.id===id&&!p.system)||!s.audience.data.members[id]?.sessions)throw new Error('이미 만난 관객에게 메모를 남길 수 있습니다.');
    this.world.change(d=>{d.audience.members[id].note=text;});s.publish();return {ok:true};
  }
  remove(id){
    const s=this.studio,p=s.settings.personas.find(p=>p.id===id);
    if(!p||p.system||id===s.settings.managerId)throw new Error('다른 매니저를 지정한 뒤 일반 관객을 제거하세요.');
    this.world.change(d=>{d.autonomy.retired[id]={persona:p,reason:'removed',at:s.now()};d.settings.personas=d.settings.personas.filter(p=>p.id!==id);});
    s.audience.presence[id]='away';s.queue=s.queue.filter(m=>m.personaId!==id);s.log(`${p.name} 관객 제거 · 이전 기록과 메모는 보존`);s.publish();return {ok:true};
  }
  source(path,clip){
    const keys=path==='clip'?['clip']:['browse','guide','fan','discussion'];const key=keys[Math.min(keys.length-1,Math.floor(this.studio.random()*keys.length))];
    return {path,key,label:path==='points'?`포인트로 열린 첫 만남 · ${profiles[key].label}`:profiles[key].label,...(clip?{clipId:clip.id}:{})};
  }
  async arrive(requestId,{path='points',clip}={}){
    z.string().uuid().parse(requestId);const s=this.studio;
    const prior=this.world.data.autonomy.receipts[requestId];
    if(prior)return {id:requestId,...prior};
    if(!s.running||s.settings.mode!=='live')throw new Error('실제 AI 방송 중에 새로운 관객을 만날 수 있습니다.');
    if(s.busy||this.pending)throw new Error('관객 응답이 끝난 뒤 새로운 만남을 열 수 있습니다.');
    if(path==='points'&&!s.settings.pointsEnabled)throw new Error('가상 포인트 기능이 꺼져 있습니다.');
    if(s.settings.personas.length>=40)throw new Error('현재 방송실의 관객 자리가 가득 찼습니다.');
    if(Object.keys(this.world.data.autonomy.receipts).length>=10000)throw new Error('이 프로필의 만남 기록 한도에 도달했습니다.');
    if(s.calls>=s.settings.maxCalls)throw new Error('세션 모델 호출 한도에 도달했습니다.');
    const source=this.source(path,clip),cost=path==='points'?ARRIVAL_PRICE:0,at=s.now();
    this.world.change(d=>{
      if(d.economy.balance<cost)throw new Error('새로운 만남에 필요한 포인트가 부족합니다.');
      d.economy.balance-=cost;d.autonomy.receipts[requestId]={status:'pending',cost,at,source};
      d.economy.purchases.push({id:requestId,kind:'arrival',key:requestId,cost,status:'pending',at,fingerprint:createHash('sha256').update(requestId).digest('hex')});
      s.economy.entry(d.economy,'hold',-cost,'새로운 관객을 구성하는 동안 포인트 보관');
    });
    const epoch=s.epoch;this.pending=requestId;s.busy=true;s.reserveCall();s.publish();
    try{
      const result=await s.provider.react({settings:{...s.settings,personas:[],webSearch:false},history:[],previous:null,speech:'',special:{kind:'audience-arrival',source,intent:profiles[source.key].intent,clip:clip?{title:clip.title,scene:clip.scene}:null,instruction:'이 유입 동기로 지금 처음 방송에 들어오는 독립적인 한국어 AI 관객 한 명을 arrival에 구성한다. 실제 사이트 이용자나 기존 관객을 복제하지 않는다. 이름과 성향은 스스로 구성하고 이전 방송을 봤다고 주장하지 않는다. messages는 비운다.'}},s.controller.signal);
      if(epoch!==s.epoch||!s.running)throw new Error('방송이 끝나 새로운 만남을 취소했습니다.');
      s.tokens+=Number(result.usage?.total_tokens)||0;const birth=result.observation.arrival;
      if(!birth)throw new Error('관객을 구성하지 못해 포인트를 반환합니다.');
      const name=birth.name?.trim();if(!name||s.settings.blockedWords.some(w=>normalized(name).includes(normalized(w))))throw new Error('관객 이름이 방송 규칙에 맞지 않습니다.');
      const taken=new Set(s.settings.personas.map(p=>normalized(p.name)));
      let unique=name;for(let n=2;taken.has(normalized(unique));n++)unique=name.slice(0,24)+n;
      const p=Persona.parse({...birth,id:randomUUID(),name:unique,enabled:true,system:false,role:'viewer',color:['#a89bff','#8bcdd2','#ffbd78','#f18fac','#99d9af'][Math.floor(s.random()*5)%5]});
      this.world.change(d=>{
        if(d.settings.personas.length>=40)throw new Error('관객 자리가 가득 차 만남을 취소했습니다.');
        d.settings.personas.push(p);d.audience.members[p.id]={...blankMember(),sessions:1,joinedAt:s.now(),origin:{...source,firstSeenAt:s.now()}};
        s.economy.wallet(d.economy,p.id);const purchase=d.economy.purchases.find(p=>p.id===requestId);purchase.status='completed';purchase.result={personaId:p.id};
        Object.assign(d.autonomy.receipts[requestId],{status:'completed',personaId:p.id});d.autonomy.lastArrivalAt=s.now();
        s.economy.entry(d.economy,'purchase',0,`새로운 만남 완료 · ${cost}P 사용`);
      });
      s.audience.presence[p.id]=s.random()<s.settings.lurkRatio?'lurking':'active';s.log(`${p.name} 첫 방문`);
      return {id:requestId,...this.world.data.autonomy.receipts[requestId]};
    }catch(error){
      this.world.change(d=>{const receipt=d.autonomy.receipts[requestId];if(receipt.status!=='pending')return;receipt.status='failed';receipt.error=error.message;
        const purchase=d.economy.purchases.find(p=>p.id===requestId);purchase.status='failed';purchase.error=error.message;d.economy.balance+=cost;s.economy.entry(d.economy,'refund',cost,error.message);
      });throw error;
    }finally{this.pending=null;if(epoch===s.epoch)s.busy=false;s.publish();}
  }
  tick(){
    const s=this.studio,now=s.now();this.seconds+=Math.min(2,Math.max(0,(now-this.lastTick)/1000));this.lastTick=now;
    if(now-this.lastSaved>=60000){this.world.change(d=>{d.autonomy.broadcastSeconds=this.seconds;});this.lastSaved=now;}
    if(now<this.nextCheck)return;this.nextCheck=now+60000;
    if(s.busy||this.pending||s.calls>=s.settings.maxCalls||s.settings.personas.length>=40||now-this.world.data.autonomy.lastArrivalAt<300000)return;
    // No catch-up bursts after suspend, no waiting character pool. Rates are
    // simulation choices: a 3% chance/minute after ten minutes of actual uptime.
    const used=new Set(Object.values(this.world.data.autonomy.receipts).filter(r=>r.status==='completed').map(r=>r.source.clipId));
    const clips=s.clips.data.filter(c=>c.creator&&now-c.createdAt>=60000&&now-c.createdAt<7*86400000&&!used.has(c.id));
    const clip=clips.length&&s.random()<.08?clips[Math.floor(s.random()*clips.length)]:null;
    if(!clip&&(this.seconds<600||s.random()>=.03))return;
    void this.arrive(randomUUID(),{path:clip?'clip':'broadcast',clip:clip||undefined}).catch(error=>{s.lastError=error.message;s.log(`관객 유입 보류: ${error.message}`);s.publish();});
  }
  evolve(changes,speech,witnesses){
    const s=this.studio,now=s.now();
    for(const change of (changes||[]).slice(0,2)){
      const p=s.settings.personas.find(p=>p.id===change.personaId&&p.enabled&&!p.system&&p.id!==s.settings.managerId),m=s.audience.data.members[change.personaId];
      if(!p||!m||!witnesses.includes(p.id)||m.seconds<300||now-(m.lastEvolutionAt||0)<600000)continue;
      const evidence=change.evidence?.trim();if(!evidence||evidence.length<4||!speech.includes(evidence))continue;
      const preference=change.preference?.trim(),nickname=change.nickname?.trim();
      if(!preference||s.settings.blockedWords.some(w=>normalized(preference+' '+nickname).includes(normalized(w))))continue;
      let renamed=false;
      this.world.change(d=>{const person=d.settings.personas.find(q=>q.id===p.id),member=d.audience.members[p.id];
        member.preferences=[...(member.preferences||[]),{text:preference,reason:change.reason,evidence,at:now}].slice(-8);member.lastEvolutionAt=now;
        person.sociability=Math.min(1,Math.max(0,person.sociability+Math.max(-.05,Math.min(.05,change.sociabilityDelta||0))));
        member.baseValues ||= person.values;person.values=(member.baseValues+'\n최근 변화: '+member.preferences.slice(-4).map(v=>v.text).join(' / ')).slice(0,1000);
        if(nickname&&nickname!==person.name&&nickname.length<=30&&now-(member.lastRenameAt||0)>=86400000&&!d.settings.personas.some(q=>normalized(q.name)===normalized(nickname))){
          member.aliases=[...(member.aliases||[]),{name:person.name,at:now}];member.lastRenameAt=now;person.name=nickname;renamed=true;
        }
      });
      if(renamed)s.log(`${p.name} 관객이 닉네임을 ${nickname}(으)로 변경했습니다.`);
    }
  }
}

import profiles from '../shared/discovery.json' with {type:'json'};

/** Research-inspired simulation. Probabilities are product choices, not measured conversion rates. */
export class Audience {
  constructor(data={members:{},lore:[],posts:[]},save=()=>{},random=Math.random){this.data=data;this.save=save;this.random=random;this.presence={};this.lastTick=0;this.lastPresence=0;this.nextArrival=0;this.lastStart=0;}
  chooseOrigin(settings,now){
    const entries=Object.entries(settings.discovery.mix).filter(([,w])=>w>0);
    let pick=this.random()*entries.reduce((sum,[,w])=>sum+w,0);
    let key=entries.at(-1)?.[0] || 'browse';
    for(const [id,weight] of entries){pick-=weight;if(pick<0){key=id;break;}}
    return {key,label:profiles[key].label,firstSeenAt:now};
  }
  join(p,settings,now){
    const m=this.data.members[p.id];const first=m.sessions===0;
    if(!m.origin)m.origin=first&&settings.discovery.enabled&&p.id!==settings.managerId?this.chooseOrigin(settings,now):{key:'direct',label:'직접 초대 · 기존 관객',firstSeenAt:now};
    m.sessions++;m.joinedAt=now;
    this.presence[p.id]=p.id===settings.managerId?'active':this.random()<settings.lurkRatio?'lurking':'active';
    return `${p.name} ${first?'첫 방문':'재방문'} · ${m.origin.label}`;
  }
  start(settings,now){
    this.presence={};this.lastTick=now;this.lastPresence=now;this.lastStart=now;this.nextArrival=now+settings.discovery.arrivalSeconds*1000;const events=[];let openingViewer=false;
    for(const p of settings.personas){
      const m=this.data.members[p.id] ||= {sessions:0,seconds:0,recognized:0,affinity:0.15,peers:{},memories:[]};
      if(!p.enabled){this.presence[p.id]='away';continue;}
      const returning=m.sessions>0&&this.random()<Math.min(.95,.4+m.affinity*.4+Math.min(.15,m.seconds/7200));
      const opening=p.id!==settings.managerId&&!openingViewer;
      if(!settings.discovery.enabled||p.id===settings.managerId||returning||opening){events.push(this.join(p,settings,now));if(p.id!==settings.managerId)openingViewer=true;}
      else this.presence[p.id]='waiting';
    }
    this.save(this.data);return settings.discovery.enabled?events:[];
  }
  stop(){this.presence={};this.save(this.data);}
  tick(settings,now,excitement=0){
    if(now-this.lastTick<1000)return [];
    const dt=Math.min(60,Math.max(0,(now-this.lastTick)/1000));this.lastTick=now;const events=[];
    const changePresence=now-this.lastPresence>=10000;if(changePresence)this.lastPresence=now;
    for(const p of settings.personas){
      if(!p.enabled){this.presence[p.id]='away';continue;}const m=this.data.members[p.id];if(!m)continue;
      const present=['active','lurking'].includes(this.presence[p.id]);if(present)m.seconds+=dt;
      if(p.id===settings.managerId){this.presence[p.id]='active';continue;}
      if(this.presence[p.id]==='waiting')continue;
      if(changePresence){
        if(excitement>0.75&&present&&this.random()<0.4)this.presence[p.id]='active';
        else if(this.random()<0.08)this.presence[p.id]=this.random()<settings.lurkRatio?'lurking':this.random()<0.12?'away':'active';
      }
    }
    if(settings.discovery.enabled&&now>=this.nextArrival){
      const waiting=settings.personas.filter(p=>p.enabled&&this.presence[p.id]==='waiting');
      if(waiting.length){const p=waiting[Math.min(waiting.length-1,Math.floor(this.random()*waiting.length))];events.push(this.join(p,settings,now));this.save(this.data);}
      // Avoid catch-up floods after system suspend or a slow request.
      this.nextArrival=now+settings.discovery.arrivalSeconds*1000;
    }
    return events;
  }
  context(settings,speech='',excitement=0){
    const candidates=[];
    for(const p of settings.personas.filter(p=>p.enabled)){
      const member=this.data.members[p.id];const named=speech.includes(p.name)&&this.presence[p.id]!=='waiting'&&member?.joinedAt>=this.lastStart;
      if(named){this.presence[p.id]='active';member.recognized++;member.affinity=Math.min(1,member.affinity+0.025);}
      const interest=profiles[member?.origin?.key];
      if(this.presence[p.id]==='active')candidates.push({id:p.id,score:this.random()+(p.sociability??0.6)*0.4+(interest?.sociability??0.5)*0.15+(named?2:0)+(p.id===settings.managerId?-0.4:0)});
    }
    const eligible=candidates.sort((a,b)=>b.score-a.score).slice(0,Math.min(settings.chatPace+1,settings.personas.length)).map(p=>p.id);
    return {eligible,members:settings.personas.filter(p=>p.enabled).map(p=>{
      const m=this.data.members[p.id];return {id:p.id,presence:this.presence[p.id] || 'away',...m,relationship:(m?.sessions>=3&&m?.seconds>=600)?'단골':m?.sessions>1?'재방문':'첫 방문',arrivalInterest:profiles[m?.origin?.key]?.intent || '직접 초대한 관객. 개인 설정과 실제 기억을 따른다.'};
    }),lore:this.data.lore.filter(l=>l.expiresAt>Date.now()).slice(-12),offStreamPosts:this.data.posts.slice(-8),rhythm:excitement>0.75?'짧은 공동 반응 뒤 안정':'평소 대화. 침묵과 관망도 자연스럽다'};
  }
  message(personaId,text,settings){const m=this.data.members[personaId];if(!m)return;
    m.memories.push(text);m.memories=m.memories.slice(-8);
    for(const p of settings.personas)if(p.id!==personaId&&text.includes(p.name))m.peers[p.id]=Math.min(20,(m.peers[p.id]||0)+1);
  }
  post(post){this.data.posts.push(post);this.data.posts=this.data.posts.slice(-60);this.save(this.data);}
  lore(text,expiresAt){this.data.lore.push({text,expiresAt});this.data.lore=this.data.lore.slice(-30);this.save(this.data);}
}

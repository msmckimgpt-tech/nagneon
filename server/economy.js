import {randomUUID,createHash} from 'node:crypto';
import rules from '../shared/economy.json' with {type:'json'};

const digest=text=>createHash('sha256').update(text).digest('hex');
const safeKey=id=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
const normalize=text=>text.normalize('NFKC').toLocaleLowerCase().replace(/[\s\p{P}\p{S}]+/gu,'');
export class Economy {
  constructor(data,save=()=>{},now=Date.now){
    this.save=save;this.lastNow=Math.max(now(),data?.timeFloor||0);this.now=()=>this.lastNow=Math.max(this.lastNow,now());
    this.data=data || {version:1,balance:rules.welcomePoints,wallets:{},ledger:[{id:randomUUID(),at:now(),kind:'welcome',amount:rules.welcomePoints,text:'첫 체험 포인트 · 현금 가치 없음'}],purchases:[],quotes:[],moments:[],rewardBlockedUntil:0,lastRewardAt:0};
    // A crash cannot strand a purchase hold. The model result had not committed.
    if(this.data.purchases.some(p=>p.status==='pending'))this.change(d=>{for(const p of d.purchases.filter(p=>p.status==='pending')){d.balance+=p.cost;p.status='failed';p.error='앱 재시작으로 취소되어 포인트를 반환했습니다.';if(p.kind==='contract'){const q=d.quotes.find(q=>q.id===p.key);if(q)q.status='failed';}this.entry(d,'refund',p.cost,p.error);} });
    else if(!data)this.save(this.data);
  }
  change(fn){const next=structuredClone(this.data);const result=fn(next);next.timeFloor=this.now();this.save(next);this.data=next;return result;}
  ensureWallets(personas){if(personas.some(p=>!this.data.wallets[p.id]))this.change(d=>{for(const p of personas)this.wallet(d,p.id);});}
  entry(d,kind,amount,text,extra={}){d.ledger.push({id:randomUUID(),at:this.now(),kind,amount,text,...extra});d.ledger=d.ledger.slice(-300);}
  incoming(d,id){return d.purchases.filter(p=>p.status==='pending'&&p.kind==='contract').reduce((sum,p)=>sum+(p.shares?.[id]||0),0);}
  wallet(d,id,at=this.now()){
    if(!safeKey(id))throw new Error('올바른 관객이 아닙니다.');
    const w=d.wallets[id] ||= {balance:rules.initialWallet,refillAt:at,lastDonationAt:0,paidUntil:0};
    const ceiling=rules.walletCap-this.incoming(d,id);
    const effective=Math.max(at,w.refillAt);const steps=Math.floor((effective-w.refillAt)/(rules.refillSeconds*1000));
    if(w.balance>=ceiling){w.balance=ceiling;w.refillAt=effective;}
    else if(steps){w.balance=Math.min(ceiling,w.balance+steps);w.refillAt=w.balance===ceiling?effective:w.refillAt+steps*rules.refillSeconds*1000;}
    return w;
  }
  snapshot(personas){
    const copy=structuredClone(this.data);const wallets={};
    for(const p of personas){const w=this.wallet(copy,p.id);wallets[p.id]={...w,cap:rules.walletCap,nextRefillAt:w.balance<rules.walletCap-this.incoming(copy,p.id)?w.refillAt+rules.refillSeconds*1000:null};}
    const quotes=copy.quotes.map(({floor,...q})=>({...q,status:q.status==='open'&&q.expiresAt<=this.now()?'expired':q.status}));
    return {balance:copy.balance,wallets,ledger:copy.ledger,quotes,purchases:copy.purchases.map(({fingerprint,shares,...p})=>p),rules};
  }
  reward({observation,settings,audience,hasInput,paid=false}){
    const m=observation.positiveMoment;
    if(!settings.pointsEnabled||!hasInput||paid||!m?.positive||m.impact<.8||observation.confidence<.75||observation.excitement<.8||!m.signature?.trim()||!m.reason?.trim())return [];
    const now=this.now(),d=this.data;
    if(now<d.rewardBlockedUntil||now-d.lastRewardAt<rules.momentCooldownSeconds*1000)return [];
    const fingerprint=digest(normalize(m.signature));
    if(d.moments.some(e=>e.fingerprint===fingerprint&&now-e.at<86400000))return [];
    const rewarded=d.moments.filter(e=>now-e.at<3600000).reduce((sum,e)=>sum+e.amount,0);
    if(rewarded>=rules.hourlyRewardCap)return [];
    return this.change(next=>{
      const donations=[];let remaining=rules.hourlyRewardCap-rewarded;
      for(const id of [...new Set(m.supporters)].slice(0,8)){
        const p=settings.personas.find(p=>p.id===id&&p.enabled&&p.id!==settings.managerId);const member=audience.data.members[id];
        if(!p||!['active','lurking'].includes(audience.presence[id])||!member||member.seconds<rules.minimumWatchSeconds)continue;
        const w=this.wallet(next,id,now);
        if(now<w.paidUntil||now-w.lastDonationAt<rules.donationCooldownSeconds*1000||w.balance<10||remaining<10)continue;
        const amount=Math.min(w.balance,remaining,Math.round(12+m.impact*12+member.affinity*8));
        w.balance-=amount;w.lastDonationAt=now;next.balance+=amount;remaining-=amount;
        this.entry(next,'donation',amount,m.reason,{personaId:id,name:p.name});donations.push({personaId:id,name:p.name,amount,reason:m.reason});
        if(donations.length>=2)break;
      }
      if(donations.length){next.lastRewardAt=now;next.moments.push({fingerprint,at:now,amount:donations.reduce((sum,v)=>sum+v.amount,0)});next.moments=next.moments.filter(e=>now-e.at<86400000).slice(-1000);}
      return donations;
    });
  }
  purchase(id,kind,key,cost,extra={}){
    if(!safeKey(id))throw new Error('구매 요청 ID가 올바르지 않습니다.');
    const fingerprint=digest(JSON.stringify({kind,key}));const existing=this.data.purchases.find(p=>p.id===id);
    if(existing){if(existing.fingerprint!==fingerprint)throw new Error('같은 요청 ID를 다른 구매에 사용할 수 없습니다.');return {existing:true,receipt:existing};}
    if(!Number.isSafeInteger(cost)||cost<0||this.data.balance<cost)throw new Error('포인트가 부족합니다.');
    return this.change(d=>{d.balance-=cost;const receipt={id,kind,key,cost,status:'pending',at:this.now(),fingerprint,...extra};d.purchases.push(receipt);d.purchases=d.purchases.slice(-500);this.entry(d,'hold',-cost,'기능 실행을 위해 포인트를 보관합니다.');return {existing:false,receipt};});
  }
  finish(id,result){return this.change(d=>{const p=d.purchases.find(p=>p.id===id);if(!p||p.status!=='pending')throw new Error('진행 중인 구매가 아닙니다.');
    if(p.kind==='contract'){
      // The reserved incoming capacity also limits recharge until settlement.
      for(const [viewer,amount] of Object.entries(p.shares)){const w=this.wallet(d,viewer);w.balance+=amount;w.paidUntil=this.now()+rules.donationCooldownSeconds*1000;}
      const q=d.quotes.find(q=>q.id===p.key);if(q)q.status='completed';d.rewardBlockedUntil=this.now()+rules.momentCooldownSeconds*1000;
    }
    p.status='completed';p.result=result;this.entry(d,'purchase',0,`${p.kind==='contract'?'합의한 행동':'특수 기능'} 완료 · ${p.cost}P 사용`);return p;
  });}
  refund(id,error){return this.change(d=>{const p=d.purchases.find(p=>p.id===id);if(!p||p.status!=='pending')return;d.balance+=p.cost;p.status='failed';p.error=error;const q=d.quotes.find(q=>q.id===p.key);if(q)q.status='failed';this.entry(d,'refund',p.cost,error);});}
  quote({targets,kind,text,settings,audience,sessionId}){
    if(!rules.actions[kind]||!targets.length||targets.length>8||new Set(targets).size!==targets.length)throw new Error('행동과 관객 1~8명을 선택하세요.');
    if(this.data.quotes.some(q=>['open','agreed','executing'].includes(q.status)&&q.expiresAt>this.now()&&q.targets.some(id=>targets.includes(id))))throw new Error('이 관객과 진행 중인 협상이 있습니다. 기존 협상을 끝내거나 취소하세요.');
    const people=targets.map(id=>{const p=settings.personas.find(p=>p.id===id&&p.enabled&&p.id!==settings.managerId);if(!p||!['active','lurking'].includes(audience.presence[id]))throw new Error('현재 시청 중인 일반 관객만 협상할 수 있습니다.');return p;});
    const forbidden=settings.blockedWords.some(w=>normalize(text).includes(normalize(w)))||(settings.spoilerGuard&&/스포일러|결말.*알려|범인.*알려/.test(text));
    const costs=people.map(p=>{const affinity=audience.data.members[p.id]?.affinity||0;const fit=kind==='debate'?p.expertise:p.sociability;return Math.max(8,Math.round(rules.actions[kind].base*(1.25-fit*.4-affinity*.25)));});
    const floor=costs.reduce((s,n)=>s+n,0),ask=Math.ceil(floor*1.35);
    const q={id:randomUUID(),sessionId,targets,kind,text:text.trim(),ask,floor,round:0,status:forbidden?'declined':'open',expiresAt:this.now()+600000,history:[{speaker:'관객',text:forbidden?'우리 방송 규칙에 맞지 않아 이 부탁은 어려워요.':`${rules.actions[kind].label}, ${people.map(p=>p.name).join('·')}가 함께 하면 ${ask}P 어때요? 성향과 친밀도를 고려한 가격이에요.`,amount:ask}]};
    return this.change(d=>{d.quotes.push(q);d.quotes=d.quotes.slice(-60);return q.id;});
  }
  bid(id,amount){return this.change(d=>{
    const q=d.quotes.find(q=>q.id===id);if(!q||q.status!=='open'||q.expiresAt<=this.now())throw new Error('만료되었거나 끝난 협상입니다.');
    if(!Number.isSafeInteger(amount)||amount<1||amount>10000)throw new Error('1~10,000P를 제안하세요.');
    q.round++;q.history.push({speaker:'스트리머',text:`${amount}P를 제안합니다.`,amount});
    if(amount>=q.floor){q.status='agreed';q.agreed=Math.min(amount,q.ask);q.history.push({speaker:'관객',text:`좋아요. ${q.agreed}P로 합의해요. 실행하면 받을게요.`,amount:q.agreed});}
    else if(q.round>=3){q.status='declined';q.history.push({speaker:'관객',text:'이번에는 가격이 맞지 않네요. 다음에 부탁해주세요.'});}
    else{q.ask=Math.max(q.floor,Math.ceil((q.ask+q.floor)/2));q.history.push({speaker:'관객',text:`그 가격은 조금 어려워요. ${q.ask}P까지는 낮출게요.`,amount:q.ask});}
    return q;
  });}
  cancel(id){this.change(d=>{const q=d.quotes.find(q=>q.id===id);if(q&&['open','agreed'].includes(q.status))q.status='cancelled';});}
  reserveContract(id,requestId,sessionId){
    const existing=this.data.purchases.find(p=>p.id===requestId);if(existing)return this.purchase(requestId,'contract',id,existing.cost);
    const q=this.data.quotes.find(q=>q.id===id);if(!q||q.status!=='agreed'||q.expiresAt<=this.now()||q.sessionId!==sessionId)throw new Error('현재 방송에서 합의한 유효한 협상이 아닙니다.');
    const shares={};q.targets.forEach((id,i)=>shares[id]=Math.floor(q.agreed/q.targets.length)+(i<q.agreed%q.targets.length?1:0));
    const copy=structuredClone(this.data);for(const id of q.targets)if(this.wallet(copy,id).balance+shares[id]>rules.walletCap-this.incoming(copy,id))throw new Error('관객 지갑의 여유가 부족합니다. 더 낮은 가격으로 다시 협상해주세요.');
    // Persist recharge and escrow together so restart cannot mint or lose transfers.
    return this.change(d=>{
      if(d.balance<q.agreed)throw new Error('포인트가 부족합니다.');
      for(const id of q.targets)this.wallet(d,id);
      d.balance-=q.agreed;const receipt={id:requestId,kind:'contract',key:id,cost:q.agreed,status:'pending',at:this.now(),fingerprint:digest(JSON.stringify({kind:'contract',key:id})),shares};
      if(!safeKey(requestId))throw new Error('구매 요청 ID가 올바르지 않습니다.');
      d.purchases.push(receipt);d.purchases=d.purchases.slice(-500);d.quotes.find(x=>x.id===id).status='executing';this.entry(d,'hold',-q.agreed,'협상한 행동의 포인트를 보관합니다.');return {existing:false,receipt};
    });
  }
}

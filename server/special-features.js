import rules from '../shared/economy.json' with {type:'json'};
import {createHash} from 'node:crypto';

export class SpecialFeatures {
  constructor(studio){this.studio=studio;}
  ready(){const s=this.studio;if(s.training.active)throw new Error('상황 연습을 종료한 뒤 사용할 수 있습니다.');if(!s.settings.pointsEnabled)throw new Error('포인트 기능이 꺼져 있습니다.');if(s.settings.mode!=='live')throw new Error('관객을 연결한 뒤 사용할 수 있습니다.');return s;}
  person(id){const s=this.ready(),p=s.settings.personas.find(p=>p.id===id);if(!p||p.system||!s.audience.data.members[id]?.sessions)throw new Error('아직 함께 방송을 본 관객이 아닙니다.');return p;}
  preferences(id){return this.studio.economy.data.purchases.filter(p=>p.status==='completed'&&p.kind==='interview'&&p.result?.personaId===id).slice(-4).map(p=>({at:p.result.at,question:p.result.question,answers:p.result.messages.map(m=>m.text)}));}
  profile(id){const p=this.person(id),m=this.studio.audience.data.members[id];return {kind:'profile',title:`${p.name} 관객 수첩`,at:this.studio.now(),personaId:id,origin:m.origin?.label || '직접 초대 · 기존 관객',values:p.values,personality:p.personality,sociability:p.sociability,expertise:p.expertise,sessions:m.sessions,seconds:m.seconds,recognized:m.recognized,affinity:m.affinity,memories:m.memories.slice(-6),preferences:this.preferences(id),note:'취향은 캐릭터 설정, 방문·호명·대화는 실제 앱 기록입니다. 친밀도는 연출 지표입니다.'};}
  relations(id){const p=this.person(id),s=this.studio,m=s.audience.data.members[id];const peers=s.settings.personas.filter(q=>q.id!==id).map(q=>({id:q.id,name:q.name,outgoing:m.peers[q.id]||0,incoming:s.audience.data.members[q.id]?.peers?.[id]||0})).filter(q=>q.incoming||q.outgoing).sort((a,b)=>b.incoming+b.outgoing-a.incoming-a.outgoing);return {kind:'relations',title:`${p.name}의 관계 지도`,at:s.now(),personaId:id,affinity:m.affinity,recognized:m.recognized,peers,note:'관객 이름을 언급하거나 직접 대댓글로 답한 대화의 방향과 횟수입니다. 언급량을 호감·우정·갈등으로 단정하지 않습니다.'};}
  unlock({kind,personaId,requestId}){
    const s=this.ready();if(!['profile','relations'].includes(kind))throw new Error('열람 종류를 확인하세요.');
    const result=kind==='profile'?this.profile(personaId):this.relations(personaId);
    const key=`${kind}:${personaId}`,previous=s.economy.data.purchases.find(p=>p.kind===kind&&p.key===key&&p.status==='completed');
    if(previous)return {...previous,result,cached:true};
    if(s.world?.revealed(personaId,kind))return {kind,key,status:'completed',cost:0,result,cached:true};
    if(s.world){
      const old=s.economy.data.purchases.find(p=>p.id===requestId);
      if(old){if(old.kind!==kind||old.key!==key)throw new Error('같은 요청 ID를 다른 구매에 사용할 수 없습니다.');return old;}
      const cost=rules.prices[kind];let receipt;
      s.world.change(d=>{if(d.economy.balance<cost)throw new Error('포인트가 부족합니다.');d.economy.balance-=cost;
        receipt={id:requestId,kind,key,cost,status:'completed',at:s.now(),fingerprint:createHash('sha256').update(JSON.stringify({kind,key})).digest('hex'),result};d.economy.purchases.push(receipt);
        s.economy.entry(d.economy,'purchase',-cost,'관객 정보 해금');
      });s.publish();return receipt;
    }
    const purchase=s.economy.purchase(requestId,kind,key,rules.prices[kind]);if(purchase.existing)return purchase.receipt;
    const receipt=s.economy.finish(requestId,result);s.publish();return receipt;
  }
  async generate({kind,personaId,messageId,question,requestId,quoteId}){
    const s=this.ready();let people,key,special;
    if(kind==='thought'){
      const message=s.messages.find(m=>m.id===messageId&&m.kind==='chat');if(!message)throw new Error('현재 방송 기록의 관객 채팅을 선택하세요.');
      people=[this.person(message.personaId)];key=message.id;special={kind,private:true,sourceMessage:message,instruction:'이 채팅에 담긴 캐릭터의 감정/바람을 짧은 창작 독백으로 써주세요.'};
    }else if(kind==='interview'){
      if(typeof question!=='string'||!question.trim()||question.length>600)throw new Error('취향 질문을 1~600자로 입력하세요.');
      people=[this.person(personaId)];key=`${personaId}:${question}`;special={kind,private:true,instruction:question};
    }else if(kind==='contract'){
      const q=s.economy.data.quotes.find(q=>q.id===quoteId);if(!q)throw new Error('협상을 찾을 수 없습니다.');
      if(!s.running||q.targets.some(id=>!['active','lurking'].includes(s.audience.presence[id])||!s.settings.personas.some(p=>p.id===id&&p.enabled)))throw new Error('합의한 관객이 현재 방송에 있어야 합니다.');
      people=q.targets.map(id=>this.person(id));key=q.id;special={kind,private:false,instruction:`${rules.actions[q.kind].prompt}\n부탁: ${q.text}`,targets:q.targets};
    }else throw new Error('특수 기능을 확인하세요.');
    const prior=s.economy.data.purchases.find(p=>p.kind===kind&&p.key===key&&p.status==='completed');if(prior&&kind==='thought')return prior;
    const retry=s.economy.data.purchases.find(p=>p.id===requestId);if(retry)return s.economy.purchase(requestId,kind,key,retry.cost).receipt;
    if(s.busy)throw new Error('관객이 응답 중입니다. 잠시 뒤 다시 실행하세요.');
    if(s.calls>=s.settings.maxCalls)throw new Error('세션 모델 호출 한도에 도달했습니다.');
    const held=kind==='contract'?s.economy.reserveContract(quoteId,requestId,s.sessionId):s.economy.purchase(requestId,kind,key,rules.prices[kind]);if(held.existing)return held.receipt;
    const epoch=s.epoch;s.busy=true;if(s.controller.signal.aborted)s.controller=new AbortController();s.reserveCall();s.publish();
    try{
      const result=await s.provider.react({settings:{...s.settings,personas:people,chatPace:kind==='contract'?people.length:3,webSearch:false},history:s.messages,previous:s.observation,audience:{members:people.map(p=>({id:p.id,...s.audience.data.members[p.id],...(['interview','thought'].includes(kind)?{privateInterviews:this.preferences(p.id)}:{})}))},speech:'',special},s.controller.signal);
      if(epoch!==s.epoch)throw new Error('방송 상태가 바뀌어 실행을 취소했습니다.');
      if(people.some(p=>!s.settings.personas.some(current=>current.id===p.id&&current.enabled)))throw new Error('관객이 제거되거나 참여를 중지해 포인트를 반환했습니다.');
      if(kind==='contract'&&people.some(p=>!['active','lurking'].includes(s.audience.presence[p.id])))throw new Error('합의한 관객이 자리를 비워 포인트를 반환했습니다.');
      s.tokens+=Number(result.usage?.total_tokens)||0;
      const seen=new Set();const messages=result.observation.messages.filter(m=>people.some(p=>p.id===m.personaId)&&!(m.spoiler&&s.settings.spoilerGuard)&&!s.settings.blockedWords.some(w=>m.text.normalize('NFKC').toLocaleLowerCase().includes(w.normalize('NFKC').toLocaleLowerCase()))).filter(m=>{if(kind==='contract'&&seen.has(m.personaId))return false;seen.add(m.personaId);return true;});
      if(!messages.length||(kind==='contract'&&people.some(p=>!seen.has(p.id))))throw new Error('합의한 응답을 완성하지 못해 포인트를 반환했습니다.');
      const output={kind,title:kind==='thought'?'채팅 뒤의 속마음':kind==='interview'?'취향 인터뷰':'합의한 채팅 행동',at:s.now(),personaId:people[0].id,question:special.instruction,sourceMessage:special.sourceMessage,messages:messages.map(m=>({...m,name:people.find(p=>p.id===m.personaId).name})),note:kind==='thought'?'AI 캐릭터의 창작 독백입니다. 모델의 비공개 추론이 아닙니다.':kind==='interview'?'캐릭터 설정과 대화 기록을 바탕으로 구성한 가상 취향 답변입니다.':'현재 방송에서 한 번 수행한 채팅 행동입니다.'};
      const receipt=s.economy.finish(requestId,output);
      if(kind==='contract')for(const m of messages)s.addMessage(m.personaId,m.text,'chat');
      return receipt;
    }catch(error){s.economy.refund(requestId,error.message);throw error;}
    finally{if(epoch===s.epoch)s.busy=false;s.publish();}
  }
  quote(input){const s=this.ready();if(!s.running)throw new Error('방송 중에 관객에게 부탁할 수 있습니다.');const id=s.economy.quote({...input,settings:s.settings,audience:s.audience,sessionId:s.sessionId});s.publish();return {id};}
}

const topics=[
  {id:'celebration',title:'우리끼리 축하하는 시간',test:/축하|기념|드디어|해냈|생일|주년/,prompt:'실제로 밝힌 성취나 기념의 의미에 각자 반응한다. 수상 소감이나 팬 축제 같은 과장된 놀이도 원하면 대화 안에서 이어가되 가상 놀이임을 유지한다.'},
  {id:'radio',title:'작은 라디오',test:/라디오|새벽|음악|노래|잠이 안/,prompt:'친근한 라디오처럼 한 명이 주제에 맞는 질문이나 짧은 자기 취향을 건네고 서로 이야기한다. 확인되지 않은 음악 제목이나 가사는 만들지 않는다.'},
  {id:'taste',title:'서로의 취향 알아가기',test:/취향|좋아하는|요즘.*빠|최애/,prompt:'관객 각자의 다른 취향으로 짧게 주고받는다. 인기투표나 취향 논쟁도 자연스러우면 가능하지만 스트리머의 답을 반복해서 요구하지 않는다.'},
  {id:'improv',title:'채팅에서 시작된 놀이',test:/심심|뭐.*놀|상상해|만약에|역할극/,prompt:'짧은 상상 질문이나 소소한 역할극을 한 명이 먼저 건넨다. 받아주면 함께 이어가고 관심 없으면 바로 평소 채팅으로 돌아간다.'},
  {id:'challenge',title:'같이 넘는 고비',test:/도전|막혔|실패|훈수|힌트/,prompt:'도전과 시행착오에 각자 반응하고 함께 결과를 기다린다. 훈수 정책과 실제 요청을 우선하며 실패를 조롱하거나 벌칙·보상을 강요하지 않는다.'},
  {id:'memories',title:'함께한 이야기',test:/기억나|처음.*방송|추억|그때/,prompt:'자기에게 실제 제공된 대화 기록만 기억한다. 새 관객도 맥락을 물으며 참여할 수 있게 하고 단골만의 대화로 소외시키지 않는다.'}
];
export class Ambient {
  constructor(studio){this.studio=studio;this.reset();}
  reset(){this.active=null;this.until=0;this.quietUntil=0;this.turns=0;this.nextIdleAt=0;}
  idle(witnesses,{observing=false}={}){
    const s=this.studio,now=s.now();
    if(!s.ai.allowed('ambient'))return null;
    if(now<this.quietUntil||now<this.nextIdleAt||s.queue.length)return null;
    // The system manager is not a substitute audience. Do not spend the
    // opportunity before an actual viewer is present, including quiet lurkers.
    if(!s.settings.personas.some(p=>p.enabled&&!p.system&&p.id!==s.settings.managerId&&witnesses.includes(p.id)))return null;
    if(!s.messages.some(m=>m.kind==='streamer'&&!m.fictional&&m.time<=now&&now-m.time<1200000))return null;
    const last=Math.max(s.startedAt,...s.messages.filter(m=>!m.fictional).map(m=>m.time));
    if(now-last<60000)return null;
    // One opportunity per 75–135s with viewers present, including empty responses. This cannot
    // continuously wake itself or generate points/clips from an old scene.
    this.nextIdleAt=now+75000+s.random()*60000;
    const priority=observing?'한동안 채팅이 없었다는 대화 기회이며 현재 화면이 정적이라는 판정은 아니다. 현재 화면·소리에서 실제 새 사건이 보이거나 스트리머가 집중할 상황이면 그 흐름을 먼저 따른다. 화면의 작은 애니메이션·반복 음악만 바뀌고 특별한 사건이 없으면, 과거 대화를 지금 처음 들은 듯 되풀이하지 말고 아래의 가벼운 대화도 가능하다.':'새 화면 사건은 없다.';
    return {id:'quiet-company',idle:!observing,watching:observing,instruction:priority+' 자기에게 제공된 방송 대화와 취향에서 한 명이 관심 가는 작은 소재를 골라 자기 생각을 건넨다. 새 질문을 기다리거나 직전 발언을 요약하는 대신 아직 말하지 않은 개인적인 취향·작은 상상을 한두 문장으로 꺼낼 수 있다. 새로 드러내는 취향은 가능하지만 함께한 과거·외부 사건을 만들어 내지는 않는다. 이미 답한 질문·축하·약속을 반복하지 않고 답을 재촉하지 않는다. 대화할 근거가 없거나 집중/휴식 중이면 침묵도 가능하다. 이런 잡담은 최대 한 명만 말한다. 새 장면·소리·진행 변화·마이크 고장을 추측하지 않는다.'};
  }
  context(speech){const s=this.studio,now=s.now();
    if(/(?:채팅|질문|말|얘기|중계).{0,12}그만|그만\s*(?:해|하|말)|쉬고 싶|조용히|말.*걸지|그 얘기.*싫/.test(speech)){this.active=null;this.quietUntil=now+600000;return {quiet:true,instruction:'스트리머가 그만하거나 쉬기를 원했다. 놀이와 새 화제를 중단하고 재촉하지 않는다.'};}
    if(/다시.{0,8}(?:얘기|말|채팅)|말\s*걸어|심심|같이\s*얘기/.test(speech))this.quietUntil=0;
    if(now<this.quietUntil)return {quiet:true,instruction:'잠시 쉬는 중. 먼저 질문이나 이벤트를 꺼내지 않는다. 새로운 명시적 질문에는 짧게 답한다.'};
    if(this.active&&(now>this.until||this.turns>=5))this.active=null;
    const topic=topics.find(t=>t.test.test(speech));
    if(topic){if(this.active?.id!==topic.id)this.turns=0;this.active=topic;this.until=now+240000;}
    if(!this.active)return null;this.turns++;
    return {id:this.active.id,title:this.active.title,turn:this.turns,instruction:this.active.prompt+' 별도 모드나 진행 버튼 없이 현재의 대화로 이어간다. 억지로 이벤트를 선언하거나 모두 한꺼번에 말하지 않는다. 새 게임 장면과 스트리머의 정정·거절이 우선이다.'};
  }
  snapshot(){return {active:this.active&&this.studio.now()<this.until?{id:this.active.id,title:this.active.title}:null,quiet:this.studio.now()<this.quietUntil};}
}

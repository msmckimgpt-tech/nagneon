// 관객 개인별 게임 지식 패킷 빌더.
//
// 원칙
// - 개인 목격(witnessed): 그 관객 ID 가 관찰의 witnesses 스냅샷에 들어 있는 장면만. 본인이 실제로 본 것.
// - 일반 배경 지식(generalFamiliarity): 게임 인지도(popularity)와 페르소나 숙련도(expertise)에서 온다. 시청과 무관.
// - 개인 숙지도(personalFamiliarity): 본인이 이 방송에서 실제로 시청한 시간(watchedSeconds)으로만 쌓인다.
// - 레거시/무 provenance 관찰(witnesses 없음)은 개인 목격으로 승격하지 않고 공용 배경(priorScenes)으로만 노출한다.
// - 스트리머가 알려준 공용 지식(taughtNotes)은 개인 목격과 구분해 전달한다.
// - 신규 관객은 witnessed 가 비고 watchedSeconds=0 이므로 다른 관객의 개인 기억을 자기 지식으로 받지 않는다.

const clamp=(v)=>Math.min(1,Math.max(0,v));
const round=(v)=>Math.round(v*100)/100;

// 게임 인지도와 페르소나 숙련도로 만드는 일반적 배경 지식(개인 관찰 이력과 무관).
export function generalFamiliarity(popularity=0.5,expertise=0.5){return clamp(popularity*0.4+expertise*0.4);}
// 본인이 이 방송에서 직접 시청한 시간으로만 쌓이는 개인적 숙지도.
export function personalFamiliarity(watchedSeconds=0){return clamp(Math.log2(1+Math.max(0,watchedSeconds)/3600)*0.3);}

// 한 게임 엔트리(knowledge.get 결과)에서 한 관객의 개인 지식 패킷을 만든다.
export function viewerKnowledge(entry,{viewerId,expertise=0.5,popularity=0.5,witnessLimit=8,sharedLimit=6,noteLimit=6}={}){
  const observations=Array.isArray(entry?.observations)?entry.observations:[];
  const watchedSeconds=Number(entry?.watched?.[viewerId])||0;
  // 본인이 목격자 스냅샷에 포함된 장면만 개인 기억으로 인정한다.
  const witnessed=observations.filter(o=>Array.isArray(o.witnesses)&&o.witnesses.includes(viewerId)).slice(-witnessLimit).map(o=>({text:o.text,at:o.at}));
  // provenance 가 없는(레거시) 관찰만 공용 배경으로. 다른 관객이 목격해 witnesses 가 채워진 장면은 여기에서 제외되어 개인 기억이 새지 않는다.
  const priorScenes=observations.filter(o=>!Array.isArray(o.witnesses)||o.witnesses.length===0).slice(-sharedLimit).map(o=>o.text);
  const general=generalFamiliarity(popularity,expertise);
  const personal=personalFamiliarity(watchedSeconds);
  return {
    game:entry?.name,
    generalFamiliarity:round(general),
    personalFamiliarity:round(personal),
    familiarity:round(clamp(general+personal*(1-general))),
    watchedSeconds:Math.round(watchedSeconds),
    firstHand:witnessed.length>0,
    witnessed,               // 본인이 실제로 목격한 장면(개인 기억)
    taughtNotes:Array.isArray(entry?.notes)?entry.notes.slice(-noteLimit).map(n=>n.text):[], // 스트리머가 알려준 공용 지식
    priorScenes              // 과거 방송에서 다뤄졌으나 본인이 목격했다고 볼 수 없는 공용 맥락
  };
}

// 이번 모델 호출에 참여하는 각 관객의 개인 지식 패킷 맵(personaId -> packet).
// 주의: 다중 페르소나 한 번 호출에서는 이 패킷들이 한 입력에 함께 담긴다. 즉 입력은 물리적으로 공유되며
// 암호적/실행적 격리가 아니다. 각 관객이 자기 항목만 자기 지식으로 쓰도록 프롬프트로 지시하고, 문서에 한계를 명시한다.
export function viewerKnowledgeByPersona(entry,personas=[],{popularity=0.5}={}){
  const map={};
  for(const p of personas)map[p.id]=viewerKnowledge(entry,{viewerId:p.id,expertise:p.expertise??0.5,popularity});
  return map;
}

// Public context excludes everyone's personal memories. Each speaking persona
// receives its own memory and only chat/previous frames after its latest entry.
// Packets still share one model call; this is provenance, not secret isolation.
export function liveViewerContext(audience,personas,history,previous,{journal,speech='',sound}={}){
  const packets={};
  for(const p of personas){
    const member=audience.members.find(m=>m.id===p.id);const joinedAt=member?.joinedAt;
    packets[p.id]={
      joinedAt,heardSounds:sound?.context(p.id)||[],memories:journal?[]:structuredClone(member?.memories||[]),
      ...(journal?{recollections:journal.recall(p.id,speech,Number.isFinite(joinedAt)?history.filter(m=>m.time>=joinedAt).slice(-35).map(m=>m.id):[])}:{}),
      chatHistory:Number.isFinite(joinedAt)?history.filter(m=>m.time>=joinedAt).slice(-35):[],
      previous:Number.isFinite(joinedAt)&&previous?.at>=joinedAt?structuredClone(previous):null
    };
  }
  const members=audience.members.map(({memories,...member})=>member);
  return {audience:structuredClone({...audience,members}),viewerContext:packets};
}

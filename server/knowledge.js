import { randomUUID } from 'node:crypto';

// actor 규칙과 동일하게 목격자/시청자 ID 를 검증한다. 프로토타입 오염 키를 차단한다.
const safeId=(id)=>typeof id==='string'&&/^[a-zA-Z0-9_-]{1,80}$/.test(id)&&!['__proto__','constructor','prototype'].includes(id);
// 게임 키를 프로토타입 오염 없이 own·enumerable 로 설정한다. '__proto__'/'constructor' 같은 키도 프로토타입을 건드리지 않는다.
const setEntry=(map,key,value)=>Object.defineProperty(map,key,{value,writable:true,enumerable:true,configurable:true});
// 기존 맵의 게임 키를 새 최상위 맵으로 얕게 복사한다(skip 키는 제외). 엔트리 객체는 공유하되 맵만 새로 만들어, 변경 엔트리를 기존 맵에 in-place 로 쓰지 않는다.
const copyEntries=(entries,skip)=>{const out={};for(const k of Object.keys(entries))if(k!==skip)setEntry(out,k,entries[k]);return out;};

export class Knowledge {
  constructor(entries={},save=()=>{}) {this.entries=entries;this.save=save;this.lastSeen=null;}
  key(name){return name.normalize('NFKC').trim().toLocaleLowerCase();}
  get(name,popularity=0.5){const key=this.key(name);const entry=Object.hasOwn(this.entries,key)?this.entries[key]:{name,seconds:0,observations:[],notes:[],watched:{}};return {...structuredClone(entry),familiarity:Math.min(1,popularity*0.4+Math.log2(1+entry.seconds/3600)*0.2)};}
  // 새 엔트리 맵(next)을 먼저 저장에 성공시킨 뒤에만 in-memory 상태를 교체한다. save 가 던지면 this.entries 는 그대로 유지된다.
  // save 어댑터가 인자를 변형할 수 있으므로 사본을 넘겨, 커밋될 맵(next)과 그 하위 객체가 오염되지 않게 한다.
  #commit(next){this.save(structuredClone(next));this.entries=next;}
  // 관찰을 기록하고, 캡처 시점 목격자 스냅샷(witnesses)과 목격자별 시청 시간(watched)을 남긴다.
  // witnesses 는 studio 가 요청 캡처 시점에 함께 화면을 본(active/lurking, 이번 세션 입장) 관객 ID 다.
  observe(name,scene,at,popularity=0.5,witnesses=[]){
    const key=this.key(name);const e=this.get(name,popularity);
    const ids=[...new Set(Array.isArray(witnesses)?witnesses:[])].filter(safeId);
    const gap=this.lastSeen?.key===key?Math.min(60,Math.max(0,(at-this.lastSeen.at)/1000)):0;
    const previousWitnesses=this.lastSeen?.key===key?this.lastSeen.witnesses||[]:[];
    e.seconds+=gap;
    const watched={...(e.watched||{})};if(gap>0)for(const id of ids)if(previousWitnesses.includes(id))watched[id]=(watched[id]||0)+gap;e.watched=watched;
    const last=e.observations.at(-1);const sameWitnesses=last?.witnesses?.length===ids.length&&ids.every(id=>last.witnesses.includes(id));
    // Re-observing the same scene with new witnesses is a new, dated memory.
    // Do not add newcomers to an earlier record retroactively.
    if(scene&&!(last?.text===scene&&sameWitnesses))e.observations.push({id:randomUUID(),text:scene,at,witnesses:ids});
    e.observations=e.observations.slice(-30);delete e.familiarity;
    const next=copyEntries(this.entries);setEntry(next,key,e);
    // 저장이 성공해야만 시간·목격자 스냅샷을 확정한다. 실패(throw)하면 lastSeen 은 advance 하지 않아 간격/캡처 상태가 오염되지 않는다.
    this.#commit(next);this.lastSeen={key,at,witnesses:ids};
  }
  // 스트리머가 명시적으로 알려준 공용 지식. 개인 목격(observations)과 구분해 notes 에 저장한다.
  teach(name,text){const key=this.key(name);const e=this.get(name);e.notes.push({id:randomUUID(),text,at:Date.now()});e.notes=e.notes.slice(-50);delete e.familiarity;const next=copyEntries(this.entries);setEntry(next,key,e);this.#commit(next);}
  forget(name){const next=copyEntries(this.entries,this.key(name));this.#commit(next);this.lastSeen=null;}
}

import type {SoundState} from './types';
const names:Record<string,string>={'Music':'음악','Speech':'음성','Silence':'무음','Beep, bleep':'전자음','Electronic music':'전자 음악','Video game music':'게임 음악','Explosion':'폭발음','Gunshot, gunfire':'총성','Footsteps':'발소리','Alarm':'경보음','Conversation':'대화','Singing':'노래','Laughter':'웃음','Applause':'박수','Sound effect':'효과음'};
export function SoundPanel({sound,enabled,status,level}:{sound?:SoundState;enabled:boolean;status:string;level:number}){
  const recent=sound?.last&&Date.now()-sound.last.endedAt<30000?sound.last:null;
  if(!enabled)return null;
  return <div className="sound-panel" aria-label="관객이 듣는 소리"><div><b>관객이 듣는 소리</b><span>{status}</span><meter min={0} max={1} value={level} aria-label="시스템 출력 음량"/></div><small>시스템 출력 전체 · 마이크와 별도 · 로컬 분석</small>
    {recent?<><p>{recent.silent?'지금은 조용해요':recent.classes.length?recent.classes.slice(0,4).map(c=>names[c.label]||c.label).join(' · ')+' 소리로 추정':'소리는 들리지만 종류가 뚜렷하지 않아요'}</p>{recent.systemSpeech&&<p><b>출력 소리 속 대사</b> “{recent.systemSpeech}”</p>}<small>종류와 대사는 추정이며, 스트리머의 발언으로 취급하지 않습니다.</small></>:<p>소리를 모으는 중입니다. 방송 중 약 4초씩 분석합니다.</p>}
  </div>;
}

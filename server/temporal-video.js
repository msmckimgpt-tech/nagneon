import {VIDEO_WINDOW_MS,VIDEO_FRESH_MS} from '../shared/temporal-policy.js';

// All images in a shared model call must be after every present viewer's entry.
// This deliberately trims the shared window on arrivals instead of relying on
// a prompt to hide an older image from a newcomer in the same inference.
export function temporalVideo(video,{now,sessionId,startedAt,joinedAt=[],previous}={}){
  if(!video)return null;
  if(video.sessionId!==sessionId)throw Error('이미 끝난 방송의 화면은 전달할 수 없습니다.');
  if(video.frames.some(f=>f.at>now+1000))throw Error('화면을 수집한 시각을 확인하세요.');
  if(previous?.sourceId===video.sourceId&&video.frames.at(-1).at<previous.through)return {ignored:'older-window'};
  const since=Math.max(startedAt,now-VIDEO_WINDOW_MS,...joinedAt.filter(Number.isFinite));
  const frames=video.frames.filter(f=>f.at>=since&&f.at<=now);
  if(!frames.length||now-frames.at(-1).at>VIDEO_FRESH_MS)return {frames:[],timeline:null};
  const sameSource=previous?.sourceId===video.sourceId;
  const through=sameSource?previous.through:0;
  return {frames,timeline:{sourceId:video.sourceId,from:frames[0].at,through:frames.at(-1).at,
    sampled:true,sourceChanged:!!previous&&!sameSource,
    gapBeforeMs:through?Math.max(0,frames[0].at-through):null,
    frames:frames.map((f,i)=>({index:i+1,capturedAt:f.at,ageMs:now-f.at,gapMs:i?f.at-frames[i-1].at:0,alreadyObserved:sameSource&&f.at<=through,...(f.still?.since>=since?{still:f.still}:{})}))}};
}

export const temporalInstructions=`screenTimeline이 있으면 첨부 이미지들은 서로 다른 사진이 아니라 같은 방송에서 시간순으로 추린 연속 장면이다. frames.index가 첨부 순서이며 capturedAt, gapMs, ageMs는 실제 수집 시각과 간격이다. 첫 장부터 마지막 장까지 대상의 이동, 시작-시도-결과, 화면 전환을 연결해서 이해하고 마지막 장을 현재 상태로 삼는다. scene에는 확실히 보인 변화와 마지막 상태를 간결히 담는다. 한 장뿐이면 움직임을 단정하지 않는다. sampled=true는 중간 화면이 생략됐다는 뜻이다. 큰 시간 간격이나 화면 전환 너머의 과정, 버튼 입력, 실패 원인, 소리를 만들어 잇지 않는다. sourceChanged 또는 gapBeforeMs가 크면 이전 장면에서 계속 이어졌다고 단정하지 않는다.
alreadyObserved=true인 장면은 연결을 위한 앞부분이며 새로운 사건처럼 재반응하지 않는다. 같은 동작을 사진마다 새 사건으로 세지 않는다. 직전 성취나 실수에 이미 반응했다면 진행이 달라졌을 때만 반응한다. 마지막 화면에 사라진 위험에 지금 피하라는 늦은 훈수를 하지 않는다. 방금 끝난 시도에 반응한다면 짧은 감탄이나 회고로 말한다. 자연스러운 채팅에서는 프레임/이미지/분석/관측 보고를 나열하지 않는다. 의미 있는 변화가 없으면 말하지 않아도 된다.
still은 동일한 픽셀인 중간 표본을 줄인 기록이다. since부터 해당 capturedAt까지 samples개 표본이 같았으므로 첨부 두 장뿐이라는 이유로 중간을 전혀 못 봤다고 말하지 않는다. 표본 사이의 모든 순간까지 정지였다고 단정할 필요는 없다. 평소에는 '그대로 있네'처럼 상태에 답하며 자료 개수나 전송 방식을 설명하지 않는다. 사용자가 인식 방식이나 놓친 부분 자체를 물을 때만 정확한 한계를 설명한다.
heardSounds의 startedAt/endedAt과 liveSpeech.capture 시각을 화면 수집 시각에 맞춰 참고한다. 서로 겹쳤다는 사실만으로 원인 관계나 화면 밖 행동을 확정하지 않는다. 발언은 화면 묘사보다 우선해서 듣고 답한다.`;

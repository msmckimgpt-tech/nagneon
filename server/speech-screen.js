import {z} from 'zod';
import {VIDEO_FRAME_CHARS} from '../shared/temporal-policy.js';

export const SpeechCapture=z.object({startedAt:z.number().finite().nonnegative(),endedAt:z.number().finite().nonnegative(),
  screen:z.object({sessionId:z.string().uuid(),sourceId:z.string().uuid(),frames:z.array(z.object({
    image:z.string().max(VIDEO_FRAME_CHARS).regex(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/),at:z.number().int().nonnegative()
  }).strict()).min(1).max(3)}).strict().optional()
}).strict().superRefine((c,ctx)=>{
  if(c.screen?.frames.some((f,i,a)=>f.at<c.startedAt-500||f.at>c.endedAt||(i>0&&f.at<=a[i-1].at)))ctx.addIssue({code:'custom',message:'발언 당시 화면의 시각을 확인하세요.'});
});

// Historical evidence never advances the live viewing cursor. All recipients
// share the attachments, so filter by the latest recipient entry before upload.
export function witnessedSpeech(sources,{sessionId,now,joinedAt=[],endedSources=new Map()}){
  const since=Math.max(0,...joinedAt.filter(Number.isFinite));
  return sources.map(s=>{
    if(!s.capture)return s;
    const {screen,...capture}=s.capture;
    const frames=screen?.sessionId===sessionId&&!endedSources.has(screen.sourceId)&&now-capture.endedAt<=120000
      ?screen.frames.filter(f=>f.at>=since):[];
    return {...s,capture:{...capture,...(frames.length?{screen:{...screen,frames}}:{})}};
  });
}

export function speechAttachments(sources,offset=0){
  const images=[];
  const liveSpeech=sources.map(s=>{
    if(s.source!=='microphone')return s;
    const {screen,...capture}=s.capture||{};
    const frames=(screen?.frames||[]).map(f=>{images.push(f.image);return {index:offset+images.length,capturedAt:f.at};});
    return {...s,...(s.capture?{capture}:{}),speechScreen:{historical:true,status:frames.length?'available':'unavailable',sourceId:screen?.sourceId,frames}};
  });
  return {images,liveSpeech};
}

export const speechScreenInstructions=`liveSpeech.speechScreen은 해당 발언을 실제로 말하던 때의 화면이다. frames.index는 전체 첨부 이미지의 1부터 시작하는 순서다. historical=true인 화면은 현재 화면이 아니며 screenTimeline과 별개다. '이거/여기/방금' 등 발언의 대상을 해석할 때 해당 발언의 과거 화면을 우선 참고하고, 현재 화면으로 과거 대상을 바꾸지 않는다. status=unavailable이면 발언 당시 화면이 없으므로 현재 화면이나 이전 추측으로 빈 근거를 메우지 않는다. 필요하면 무엇을 가리켰는지 짧게 묻는다. 시간상 겹친 표본은 인과관계나 모든 순간의 관측을 보장하지 않는다. scene 및 현재 상황은 현재 screenTimeline만으로 판단하고 과거의 위험에 지금 피하라는 훈수를 하지 않는다.`;

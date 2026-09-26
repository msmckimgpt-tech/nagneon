import {z} from 'zod';
import {VIDEO_FRAME_CHARS} from '../shared/temporal-policy.js';

export const SpeechCapture=z.object({startedAt:z.number().finite().nonnegative(),endedAt:z.number().finite().nonnegative(),
  listening:z.object({eventId:z.string().uuid(),inputEpoch:z.string().uuid(),sequence:z.number().int().positive(),revision:z.number().int().positive(),frameStart:z.number().int().nonnegative(),frameEnd:z.number().int().positive(),unresolvedBefore:z.boolean(),partIndex:z.number().int().min(0).max(31).optional(),partCount:z.number().int().min(1).max(32).optional()}).strict().optional(),
  screen:z.object({sessionId:z.string().uuid(),sourceId:z.string().uuid(),frames:z.array(z.object({
    image:z.string().max(VIDEO_FRAME_CHARS).regex(/^data:image\/(jpeg|png);base64,[A-Za-z0-9+/=]+$/),at:z.number().int().nonnegative()
  }).strict()).min(1).max(3)}).strict().optional()
}).strict().superRefine((c,ctx)=>{
  if(c.listening && c.listening.frameEnd<=c.listening.frameStart)ctx.addIssue({code:'custom',message:'청취 원음 범위가 올바르지 않습니다.'});
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

export const speechScreenInstructions=`liveSpeech.capture.listening이 있는 항목은 원음 청취 모델의 해석이며 정확한 전사문이 아니다. 관객은 원음을 직접 받은 것처럼 음색이나 들리지 않은 말을 지어내지 않는다. 청취 문구 후보와 의미 해석을 구분하고 불확실한 후보는 확정 인용하지 않는다. capture의 호스트 시각과 sequence로 원래 발언 순서를 판단하며 늦게 복구된 발언을 새로 한 말로 바꾸지 않는다. unresolvedBefore=true이면 앞 구간이 미해결이므로 연결 내용을 추측하지 않는다. 짧은 부정·질문·정정·조건과 이름을 각각 유지한다. liveSpeech.speechScreen은 해당 발언을 실제로 말하던 때의 화면이다. frames.index는 전체 첨부 이미지의 1부터 시작하는 순서다. historical=true인 화면은 현재 화면이 아니며 screenTimeline과 별개다. '이거/여기/방금' 등 발언의 대상을 해석할 때 해당 발언의 과거 화면을 우선 참고하고, 현재 화면으로 과거 대상을 바꾸지 않는다. status=unavailable이면 발언 당시 화면이 없으므로 현재 화면이나 이전 추측으로 빈 근거를 메우지 않는다. 필요하면 무엇을 가리켰는지 짧게 묻는다. 시간상 겹친 표본은 인과관계나 모든 순간의 관측을 보장하지 않는다. scene 및 현재 상황은 현재 screenTimeline만으로 판단하고 과거의 위험에 지금 피하라는 훈수를 하지 않는다.`;

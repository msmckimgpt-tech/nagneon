import {useEffect,useRef,useState} from 'react';
import {useSystemSound} from './useSystemSound';
import {useSoundAnalysisSource} from './useSoundAnalysisSource';
import {api} from './api';
import type {State} from './types';
import {useClipBuffer} from './useClipBuffer';
import {ClipUploads} from './clip-uploads';
import {SpeechOutbox,type SpeechCapture} from './speech-flow';
import {ContinuousListening} from './continuous-listening.ts';
import {TemporalFrames} from './temporal-frames';
import {startTemporalCapture} from './temporal-capture';
import {startReactionSchedule,type ReactionResult} from './reaction-schedule';
import {prepareCapture,releaseCapture,type CapturePhase} from './capture-preparation';

export function useMedia(state:State|null,onError:(s:string)=>void){
  const video=useRef<HTMLVideoElement>(null),screenStream=useRef<MediaStream|null>(null),micStream=useRef<MediaStream|null>(null);
  const captureVideo=useRef<HTMLVideoElement|null>(null),wasRunning=useRef(false),captureEpoch=useRef(0),acquiringMic=useRef(false);
  const temporal=useRef(new TemporalFrames());const [captureRevision,setCaptureRevision]=useState(0);
  const [sharing,setSharing]=useState(false),[mic,setMic]=useState(false),[micPreparing,setMicPreparing]=useState(false),[level,setLevel]=useState(0),[transcript,setTranscript]=useState(''),[delivery,setDelivery]=useState('');
  const [micError,setMicError]=useState(false);
  const micRetryAt=useRef(0),runtimeMicRequested=useRef(false),micMuted=useRef(false);
  const micPreparation=useRef<AbortController|null>(null);
  const capturePreparation=useRef<AbortController|null>(null),[capturePreparing,setCapturePreparing]=useState<CapturePhase|null>(null);
  const recording=useRef(false),listening=useRef<ContinuousListening|null>(null);
  const priorListeningDrain=useRef<Promise<void>>(Promise.resolve());
  const stateRef=useRef(state);stateRef.current=state;const pendingSpeech=useRef(new SpeechOutbox());const epoch=useRef(0),wake=useRef<()=>void>(()=>{});
  const clipUploads=useRef<ClipUploads|null>(null);
  const errorRef=useRef(onError);errorRef.current=onError;
  const [outputStream,setOutputStream]=useState<MediaStream|null>(null),[picture,setPicture]=useState(true);const pictureRef=useRef(true);
  const analysisStream=useSoundAnalysisSource(outputStream,message=>errorRef.current(message));
  // Analysis owns audio-only clones. Model/decoder failures must not stop the
  // original system tracks or the independent hotclip recorder.
  const sound=useSystemSound(analysisStream,state?.running&&state.settings.mode==='live'?state.sessionId:null,message=>errorRef.current(message+' 소리 분석을 확인해주세요. 클립 녹음 연결은 별도로 유지합니다.'));
  const clipRuntimeReady=!state?.runtimeComponents||state.runtimeComponents.components.find(c=>c.id==='audio')?.status==='ready';
  const clips=useClipBuffer(picture?screenStream.current:null,micStream.current,!!state?.running&&!!state?.settings.clipBufferEnabled&&clipRuntimeReady,state?.sessionId || null,outputStream,message=>errorRef.current(message));
  // Settings can enable clipping after an existing screen connection. Prepare
  // its decoder before buffering/uploading, including that entry point.
  const clipHasSource=!!screenStream.current||!!micStream.current||!!outputStream;
  useEffect(()=>{
    if(!state?.running||!state.settings.clipBufferEnabled||!clipHasSource||clipRuntimeReady)return;
    const controller=new AbortController();
    void fetch('/api/runtime/prepare',{method:'POST',headers:{'X-Backseat-Client':'studio','Content-Type':'application/json'},body:JSON.stringify({feature:'clips'}),signal:controller.signal}).then(async response=>{const result=await response.json();if(!response.ok)throw Error(result.error||'클립 구성 준비 실패');}).catch(error=>{if(!controller.signal.aborted)errorRef.current(error.message);});
    return()=>controller.abort();
  },[state?.running,state?.sessionId,state?.settings.clipBufferEnabled,clipHasSource,clipRuntimeReady]);
  useEffect(()=>{const v=video.current;if(v&&pictureRef.current&&screenStream.current&&v.srcObject!==screenStream.current){v.srcObject=screenStream.current;void v.play().catch(()=>{});}});
  function endFrames(){const {sessionId,sourceId}=temporal.current;temporal.current.reset();if(sessionId&&sourceId)void api('viewing-end',{sessionId,sourceId}).catch(()=>{if(stateRef.current?.running)errorRef.current('이전 화면의 반응 중단을 확인하지 못했습니다. 연결 상태를 확인해주세요.');});}
  function stopSound(){if(!pictureRef.current){stopScreen();return;}cancelCapture();clipUploads.current?.dispose();screenStream.current?.getAudioTracks().forEach(t=>t.stop());setOutputStream(null);}
  function cancelCapture(){captureEpoch.current++;capturePreparation.current?.abort();capturePreparation.current=null;setCapturePreparing(null);}
  function stopScreen(){cancelCapture();endFrames();clipUploads.current?.dispose();screenStream.current?.getTracks().forEach(t=>t.stop());screenStream.current=null;setOutputStream(null);setSharing(false);if(video.current)video.current.srcObject=null;if(captureVideo.current){captureVideo.current.pause();captureVideo.current.srcObject=null;}captureVideo.current=null;}
  function stopMic(){clipUploads.current?.dispose();epoch.current++;micPreparation.current?.abort();micPreparation.current=null;setMicPreparing(false);recording.current=false;const listener=listening.current;listener?.stopCapture();if(listener)priorListeningDrain.current=Promise.all([priorListeningDrain.current,listener.drained]).then(()=>{});listening.current=null;micStream.current?.getTracks().forEach(t=>t.stop());micStream.current=null;setMic(false);setLevel(0);}
  function stopAll(){runtimeMicRequested.current=false;stopScreen();stopMic();priorListeningDrain.current=Promise.resolve();if(pendingSpeech.current.items.some(item=>item.source==='microphone'))errorRef.current('방송 종료 전에 전달되지 않은 음성 발언이 있습니다. 최근 24시간의 로컬 원음 파일에서 복구할 수 있습니다.');pendingSpeech.current.clear();}
  async function share(sourceId?:string,options={systemAudio:false,picture:true}){
    if(capturePreparation.current)return;
    const ticket=++captureEpoch.current,preparation=new AbortController();capturePreparation.current=preparation;
    try{
      if(stateRef.current?.runtimeComponents&&(options.systemAudio||stateRef.current.settings.clipBufferEnabled)){
        setCapturePreparing('source');
        const response=await fetch('/api/runtime/prepare',{method:'POST',headers:{'X-Backseat-Client':'studio','Content-Type':'application/json'},body:JSON.stringify({feature:options.systemAudio?'sound':'clips'}),signal:preparation.signal});
        const result=await response.json();if(!response.ok)throw Error(result.error||'추가 구성 준비 실패');
        preparation.signal.throwIfAborted();
      }
      const prepared=await prepareCapture({signal:preparation.signal,onPhase:setCapturePreparing,picture:options.picture,acquisitionTimeoutMs:sourceId?30000:0,acquire:async()=>{
        if(sourceId&&window.backseat)await window.backseat.selectSource(sourceId,options.systemAudio);
        if(preparation.signal.aborted)throw new DOMException('화면 연결 취소','AbortError');
        return navigator.mediaDevices.getDisplayMedia({video:{frameRate:15},audio:options.systemAudio?{echoCancellation:false,noiseSuppression:false,autoGainControl:false,restrictOwnAudio:true} as MediaTrackConstraints:false});
      }});
      if(ticket!==captureEpoch.current||preparation.signal.aborted){releaseCapture(prepared);return;}
      const {stream,video:capture}=prepared;
      if(stateRef.current?.obsInput?.phase!=='disconnected'&&stateRef.current?.obsInput){try{await api('obs/disconnect');}catch(e){releaseCapture(prepared);throw e;}}
      if(ticket!==captureEpoch.current||preparation.signal.aborted){releaseCapture(prepared);return;}
      endFrames();clipUploads.current?.dispose();const previous=screenStream.current,previousVideo=captureVideo.current;
      screenStream.current=stream;captureVideo.current=capture;
      previous?.getTracks().forEach(t=>t.stop());if(previousVideo){previousVideo.pause();previousVideo.srcObject=null;}
      pictureRef.current=options.picture;setPicture(options.picture);setOutputStream(stream.getAudioTracks().length?stream:null);if(options.systemAudio&&!stream.getAudioTracks().length)errorRef.current('시스템 출력 소리를 받지 못했습니다. 소리 연결을 다시 선택해주세요.');for(const track of stream.getAudioTracks())track.onended=()=>{if(screenStream.current===stream)stopSound();};
      // The tab's preview can disappear while play() is pending. Only the
      // independent capture player owns sharing; preview teardown is harmless.
      const v=video.current;if(v){v.srcObject=options.picture?stream:null;if(options.picture)void v.play().catch(()=>{});}if(ticket!==captureEpoch.current)return;setSharing(options.picture);setCaptureRevision(n=>n+1);stream.getVideoTracks()[0].onended=()=>{if(screenStream.current===stream)stopScreen();};
    }catch(e){if(ticket===captureEpoch.current&&!preparation.signal.aborted)errorRef.current(e instanceof Error?e.message:'화면 공유를 시작하지 못했습니다.');}
    finally{if(capturePreparation.current===preparation){capturePreparation.current=null;setCapturePreparing(null);}}
  }
  useEffect(()=>{
    const capture=captureVideo.current;temporal.current.reset();
    if(!sharing||!capture||!state?.running||state.settings.mode!=='live'||!state.sessionId)return;
    temporal.current.reset(state.sessionId,crypto.randomUUID());
    const stop=startTemporalCapture(capture,temporal.current,e=>{stopScreen();errorRef.current(e instanceof Error?e.message:'연속 화면을 수집하지 못했습니다.');});
    return()=>{stop();endFrames();};
  },[sharing,captureRevision,state?.running,state?.sessionId,state?.settings.mode,state?.settings.gameId,state?.settings.category]);
  function say(text:string,source:'keyboard'|'microphone'='keyboard',capture?:SpeechCapture){const s=stateRef.current;if(!s?.running){errorRef.current('방송을 먼저 시작해주세요.');return false;}if(!pendingSpeech.current.add(text,s.sessionId,source,capture)){errorRef.current('전달할 말이 많이 밀렸어요. 관객 응답 후 마지막 말을 다시 입력해주세요.');return false;}wake.current();return true;}
  useEffect(()=>{
    if(!state?.running||!state.sessionId||!state.settings.autoHighlights||!state.settings.clipBufferEnabled||!clips.buffering)return;
    const sessionId=state.sessionId,source=screenStream.current,microphone=micStream.current,withPicture=pictureRef.current;
    const uploads=new ClipUploads({sessionId,takeAt:clips.takeAt,onError:message=>errorRef.current(message),
      allowed:()=>!!stateRef.current?.running&&stateRef.current.sessionId===sessionId&&stateRef.current.settings.autoHighlights&&stateRef.current.settings.clipBufferEnabled&&pictureRef.current===withPicture&&screenStream.current===source&&micStream.current===microphone});
    clipUploads.current=uploads;
    return()=>{uploads.dispose();if(clipUploads.current===uploads)clipUploads.current=null;};
  },[state?.running,state?.sessionId,state?.settings.autoHighlights,state?.settings.clipBufferEnabled,clips.buffering,picture,screenStream.current,micStream.current,outputStream]);
  useEffect(()=>{clipUploads.current?.add(state?.clips||[]);},[state?.clips,state?.running,state?.sessionId,state?.settings.autoHighlights,state?.settings.clipBufferEnabled,clips.buffering,picture,screenStream.current,micStream.current,outputStream]);
  async function startMic(){
    if(acquiringMic.current||micStream.current)return;
    if(!stateRef.current?.running||stateRef.current.settings.mode!=='live'){errorRef.current('실제 AI 방송을 시작한 뒤 마이크를 켜주세요.');return;}
    micMuted.current=false;setMicError(false);runtimeMicRequested.current=true;
    acquiringMic.current=true;const generation=++epoch.current,preparation=new AbortController();micPreparation.current=preparation;setMicPreparing(true);
    try{
      const response=await fetch('/api/audio/prepare',{method:'POST',headers:{'X-Backseat-Client':'studio'},signal:preparation.signal});const prepared=await response.json();if(!response.ok)throw Error(prepared.error||'음성 인식기를 준비하지 못했습니다.');
      if(generation!==epoch.current||!stateRef.current?.running)return;
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(generation!==epoch.current||!stateRef.current?.running){stream.getTracks().forEach(t=>t.stop());return;}micStream.current=stream;
      if(generation!==epoch.current||!stateRef.current?.running)return;
      for(const track of stream.getAudioTracks())track.onended=()=>{if(generation===epoch.current){stopMic();setMicError(true);micRetryAt.current=Date.now()+1000;errorRef.current('마이크 연결이 끊겨 다시 연결하고 있습니다.');}};
      const speechSessionId=stateRef.current.sessionId,deliveryGate=priorListeningDrain.current;
      const listener=new ContinuousListening({sessionId:speechSessionId,track:stream.getAudioTracks()[0],recognizeAfter:deliveryGate,
        onLevel:value=>setLevel(value),
        attachScreen:capture=>{capture.screen=temporal.current.speechWindow(capture.startedAt,capture.endedAt);},
        onTranscript:(text,capture,cues)=>{void deliveryGate.then(()=>{if(stateRef.current?.running&&stateRef.current.sessionId===speechSessionId){setTranscript(text);setDelivery(cues?.delivery||'');say(text,'microphone',capture);}});},
        onError:message=>{if(stateRef.current?.sessionId===speechSessionId)errorRef.current(message);},
        onStorageFailure:()=>{if(generation===epoch.current){runtimeMicRequested.current=false;stopMic();setMicError(true);}},
        onCaptureFailure:()=>{if(generation===epoch.current){stopMic();setMicError(true);micRetryAt.current=Date.now()+1000;errorRef.current('마이크 연속 캡처가 끊겼습니다. 연결을 확인하고 다시 시도합니다.');}}
      });
      listening.current=listener;
      await listener.start();
      if(generation!==epoch.current||!stateRef.current?.running){listener.stopCapture();return;}
      listening.current=listener;recording.current=true;setMic(true);
    }catch(e){if(generation===epoch.current){stopMic();setMicError(true);micRetryAt.current=Date.now()+5000;const components=stateRef.current?.runtimeComponents;const needed=['audio','microphone',...(stateRef.current?.settings.speechDevice==='gpu'?['gpu']:[])];const needsPreparation=components&&needed.some(id=>components.components.find(c=>c.id===id)?.status!=='ready');if(needsPreparation)runtimeMicRequested.current=false;errorRef.current((e instanceof Error?e.message:'마이크를 시작하지 못했습니다.')+(needsPreparation?' 구성을 준비한 뒤 마이크를 다시 켜주세요.':' 자동으로 다시 연결합니다.'));}}
    finally{acquiringMic.current=false;if(micPreparation.current===preparation){micPreparation.current=null;setMicPreparing(false);}}
  }
  function toggleMic(){
    if(runtimeMicRequested.current||micStream.current||acquiringMic.current){micMuted.current=true;runtimeMicRequested.current=false;stopMic();setMicError(false);}
    else void startMic();
  }
  const toggleMicRef=useRef(toggleMic);toggleMicRef.current=toggleMic;
  useEffect(()=>window.backseat?.onMicrophoneToggle?.(()=>toggleMicRef.current()),[]);
  useEffect(()=>{
    if(!state?.running||state.settings.mode!=='live')return;
    const reconnect=()=>{if(micMuted.current)return;const current=stateRef.current;if(current?.runtimeComponents){if(!runtimeMicRequested.current)return;const needed=['audio','microphone',...(current.settings.speechDevice==='gpu'?['gpu']:[])];if(needed.some(id=>current.runtimeComponents!.components.find(c=>c.id===id)?.status!=='ready'))return;}if(!recording.current&&Date.now()>=micRetryAt.current)void startMic();};
    reconnect();const timer=setInterval(reconnect,1000);navigator.mediaDevices.addEventListener('devicechange',reconnect);
    return()=>{clearInterval(timer);navigator.mediaDevices.removeEventListener('devicechange',reconnect);};
  },[state?.running,state?.sessionId,state?.settings.mode]);
  useEffect(()=>{
    if(!state?.running)return;
    const scheduler=startReactionSchedule({sessionId:state.sessionId,current:()=>stateRef.current,
      flushSpeech:delivered=>pendingSpeech.current.flush(async(item,signal)=>{const response=await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify(item),signal});const result=await response.json();if(!response.ok)throw new Error(result.error||'발언을 전달하지 못했습니다.');delivered();return result;}),
      react:async current=>{const video=!current.obsInput?.sourceId&&current.settings.mode==='live'?temporal.current.window(Date.now()):undefined;
        const result=await api<ReactionResult>('react',{video,...(current.settings.mode==='live'&&current.obsInput?.sourceId?{obsSourceId:current.obsInput.sourceId}:{})});return {...result,video};},
      onResult:result=>{if(result.video&&((result.ok&&!result.transcriptionNeedsReview)||['unchanged-input','stale-screen'].includes(result.skipped||'')))temporal.current.acknowledge(result.video);
        if(result.transcriptionNeedsReview)errorRef.current('음성을 확실하게 이해하지 못했어요. 마지막 말을 다시 들려주세요.');},
      onSpeechError:e=>errorRef.current(e instanceof Error?e.message:'발언 전달 실패 · 다시 시도하고 있습니다.'),
      onReactionError:e=>errorRef.current(e instanceof Error?e.message:'관객 응답 실패')
    });
    wake.current=scheduler.wake;return()=>{scheduler.dispose();wake.current=()=>{};};
  },[state?.running,state?.sessionId]);
  useEffect(()=>{if(state){if(wasRunning.current&&!state.running)stopAll();wasRunning.current=state.running;}},[state?.running]);
  useEffect(()=>()=>{epoch.current++;micPreparation.current?.abort();micPreparation.current=null;pendingSpeech.current.clear();temporal.current.reset();captureEpoch.current++;capturePreparation.current?.abort();capturePreparation.current=null;screenStream.current?.getTracks().forEach(t=>t.stop());if(captureVideo.current){captureVideo.current.pause();captureVideo.current.srcObject=null;}recording.current=false;listening.current?.stopCapture();listening.current=null;micStream.current?.getTracks().forEach(t=>t.stop());},[]);
  return {video,sharing,capturePreparing,cancelCapture,soundSharing:!!outputStream,soundStatus:sound.status,soundLevel:sound.level,stopSound,mic,micPreparing,micError,level,transcript,delivery,share,stopScreen,startMic,stopMic,toggleMic,stopAll,say,clipBuffering:clips.buffering};
}

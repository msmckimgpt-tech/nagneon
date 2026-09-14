import {useEffect,useRef,useState} from 'react';
import {useSystemSound} from './useSystemSound';
import {api} from './api';
import type {State} from './types';
import {useClipBuffer} from './useClipBuffer';
import {ClipUploads} from './clip-uploads';
import {VoiceBoundary,SpeechQueue,SpeechOutbox,VOICE_MAX_MS,type SpeechCapture} from './speech-flow';
import {TemporalFrames} from './temporal-frames';
import {startTemporalCapture} from './temporal-capture';
import {prepareCapture,releaseCapture,type CapturePhase} from './capture-preparation';

export function useMedia(state:State|null,onError:(s:string)=>void){
  const video=useRef<HTMLVideoElement>(null),screenStream=useRef<MediaStream|null>(null),micStream=useRef<MediaStream|null>(null);
  const captureVideo=useRef<HTMLVideoElement|null>(null),wasRunning=useRef(false),captureEpoch=useRef(0),acquiringMic=useRef(false);
  const temporal=useRef(new TemporalFrames());const [captureRevision,setCaptureRevision]=useState(0);
  const [sharing,setSharing]=useState(false),[mic,setMic]=useState(false),[micPreparing,setMicPreparing]=useState(false),[level,setLevel]=useState(0),[transcript,setTranscript]=useState(''),[delivery,setDelivery]=useState('');
  const micPreparation=useRef<AbortController|null>(null);
  const capturePreparation=useRef<AbortController|null>(null),[capturePreparing,setCapturePreparing]=useState<CapturePhase|null>(null);
  const recording=useRef(false),recorder=useRef<MediaRecorder|null>(null),context=useRef<AudioContext|null>(null);
  const stateRef=useRef(state);stateRef.current=state;const pendingSpeech=useRef(new SpeechOutbox());const epoch=useRef(0),wake=useRef<()=>void>(()=>{});
  const speechQueue=useRef<SpeechQueue<{blob:Blob;capture?:SpeechCapture},{text:string;cues?:{delivery?:string};capture?:SpeechCapture}>|null>(null);
  const clipUploads=useRef<ClipUploads|null>(null);
  const errorRef=useRef(onError);errorRef.current=onError;
  const [outputStream,setOutputStream]=useState<MediaStream|null>(null),[picture,setPicture]=useState(true);const pictureRef=useRef(true);
  const sound=useSystemSound(outputStream,state?.running&&state.settings.mode==='live'?state.sessionId:null,message=>{stopSound();errorRef.current(message);});
  const clips=useClipBuffer(picture?screenStream.current:null,micStream.current,!!state?.running&&!!state?.settings.clipBufferEnabled,state?.sessionId || null,outputStream);
  useEffect(()=>{const v=video.current;if(v&&pictureRef.current&&screenStream.current&&v.srcObject!==screenStream.current){v.srcObject=screenStream.current;void v.play().catch(()=>{});}});
  function endFrames(){const {sessionId,sourceId}=temporal.current;temporal.current.reset();if(sessionId&&sourceId)void api('viewing-end',{sessionId,sourceId}).catch(()=>{if(stateRef.current?.running)errorRef.current('이전 화면의 반응 중단을 확인하지 못했습니다. 연결 상태를 확인해주세요.');});}
  function stopSound(){if(!pictureRef.current){stopScreen();return;}cancelCapture();clipUploads.current?.dispose();screenStream.current?.getAudioTracks().forEach(t=>t.stop());setOutputStream(null);}
  function cancelCapture(){captureEpoch.current++;capturePreparation.current?.abort();capturePreparation.current=null;setCapturePreparing(null);}
  function stopScreen(){cancelCapture();endFrames();clipUploads.current?.dispose();screenStream.current?.getTracks().forEach(t=>t.stop());screenStream.current=null;setOutputStream(null);setSharing(false);if(video.current)video.current.srcObject=null;if(captureVideo.current){captureVideo.current.pause();captureVideo.current.srcObject=null;}captureVideo.current=null;}
  function stopMic(){clipUploads.current?.dispose();epoch.current++;micPreparation.current?.abort();micPreparation.current=null;setMicPreparing(false);recording.current=false;speechQueue.current?.reset();speechQueue.current=null;if(recorder.current?.state==='recording')recorder.current.stop();micStream.current?.getTracks().forEach(t=>t.stop());micStream.current=null;void context.current?.close();context.current=null;setMic(false);setLevel(0);}
  function stopAll(){stopScreen();stopMic();pendingSpeech.current.clear();}
  async function share(sourceId?:string,options={systemAudio:false,picture:true}){
    if(capturePreparation.current)return;
    const ticket=++captureEpoch.current,preparation=new AbortController();capturePreparation.current=preparation;
    try{
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
      pictureRef.current=options.picture;setPicture(options.picture);setOutputStream(stream.getAudioTracks().length?stream:null);if(options.systemAudio&&!stream.getAudioTracks().length)errorRef.current('Windows 출력 소리를 받지 못했습니다. 소리 연결을 다시 선택해주세요.');for(const track of stream.getAudioTracks())track.onended=()=>{if(screenStream.current===stream)stopSound();};
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
  function say(text:string,source:'keyboard'|'microphone'='keyboard',capture?:SpeechCapture){const s=stateRef.current;if(!s?.running){errorRef.current('방송을 먼저 시작해주세요.');return;}if(!pendingSpeech.current.add(text,s.sessionId,source,capture)){errorRef.current('전달할 말이 많이 밀렸어요. 관객 응답 후 마지막 말을 다시 입력해주세요.');return;}wake.current();}
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
    acquiringMic.current=true;const generation=++epoch.current,preparation=new AbortController();micPreparation.current=preparation;setMicPreparing(true);
    try{
      const response=await fetch('/api/audio/prepare',{method:'POST',headers:{'X-Backseat-Client':'studio'},signal:preparation.signal});const prepared=await response.json();if(!response.ok)throw Error(prepared.error||'음성 인식기를 준비하지 못했습니다.');
      if(generation!==epoch.current||!stateRef.current?.running)return;
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(generation!==epoch.current||!stateRef.current?.running){stream.getTracks().forEach(t=>t.stop());return;}micStream.current=stream;
      const ctx=new AudioContext();context.current=ctx;const source=ctx.createMediaStreamSource(stream);const analyser=ctx.createAnalyser();analyser.fftSize=512;source.connect(analyser);
      recording.current=true;setMic(true);
      const mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/mp4';
      const queue=new SpeechQueue<{blob:Blob;capture?:SpeechCapture},{text:string;cues?:{delivery?:string};capture?:SpeechCapture}>({
        execute:async({blob,capture},signal)=>{const res=await fetch('/api/audio',{method:'POST',headers:{'Content-Type':mime,'X-Backseat-Client':'studio'},body:blob,signal});const result=await res.json();if(!res.ok)throw Object.assign(new Error(result.error),{needsPreparation:result.needsPreparation===true});return {...result,capture};},
        onResult:result=>{if(generation===epoch.current&&recording.current&&result.text){setTranscript(result.text);setDelivery(result.cues?.delivery||'');say(result.text,'microphone',result.capture);}},
        onError:e=>{if(generation!==epoch.current)return;const recover=e instanceof Error&&'needsPreparation' in e&&e.needsPreparation===true;if(recover)stopMic();errorRef.current((e instanceof Error?e.message:'음성 인식 실패')+(recover?' 대기 중이던 음성은 취소됐습니다. 마이크를 다시 켠 뒤 마지막 말을 들려주세요.':''));}
      });speechQueue.current=queue;
      function segment(){
        if(!recording.current||generation!==epoch.current)return;
        const rec=new MediaRecorder(stream,{mimeType:mime});recorder.current=rec;const parts:BlobPart[]=[];const boundary=new VoiceBoundary(performance.now()),wallStartedAt=Date.now();
        const samples=new Float32Array(analyser.fftSize);
        const meter=setInterval(()=>{analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((a,b)=>a+b*b,0)/samples.length);setLevel(Math.min(1,rms*8));if(boundary.sample(rms,performance.now())&&rec.state==='recording')rec.stop();},50);
        rec.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
        rec.onstop=()=>{clearInterval(meter);clearTimeout(timer);if(generation!==epoch.current||!recording.current)return;segment();if(!boundary.hasSpeech||!parts.length)return;
          if(!queue.enqueue({blob:new Blob(parts,{type:mime}),capture:boundary.capture(wallStartedAt)})){stopMic();errorRef.current('음성 처리가 계속 밀려 마이크를 멈췄어요. 대기 중이던 말은 취소되었습니다. 잠시 후 마이크를 켜고 마지막 말을 다시 들려주세요.');}
        };
        rec.onerror=()=>{if(generation===epoch.current){stopMic();errorRef.current('마이크 녹음을 이어갈 수 없습니다. 입력 장치를 확인하고 다시 켜주세요.');}};
        rec.start();const timer=setTimeout(()=>{if(rec.state==='recording')rec.stop();},VOICE_MAX_MS);
      }
      segment();
    }catch(e){if(generation===epoch.current){stopMic();errorRef.current(e instanceof Error?e.message:'마이크를 시작하지 못했습니다.');}}
    finally{acquiringMic.current=false;if(micPreparation.current===preparation){micPreparation.current=null;setMicPreparing(false);}}
  }
  useEffect(()=>{
    if(!state?.running)return;let disposed=false,inFlight=false,nextAttemptAt=0,speechVersion=0,answeredVersion=0;const session=state.sessionId;
    const tick=async()=>{
      const s=stateRef.current;if(disposed||!s?.running||s.sessionId!==session)return;
      try{await pendingSpeech.current.flush(async(item,signal)=>{const response=await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify(item),signal});const result=await response.json();if(!response.ok)throw new Error(result.error||'발언을 전달하지 못했습니다.');speechVersion++;return result;});}
      catch(e){if(!disposed)errorRef.current(e instanceof Error?e.message:'발언 전달 실패 · 다시 시도하고 있습니다.');return;}
      const current=stateRef.current;if(disposed||pendingSpeech.current.items.length||inFlight||!current?.running||current.sessionId!==session||current.busy||current.calls>=current.settings.maxCalls)return;
      if(speechVersion===answeredVersion&&Date.now()<nextAttemptAt)return;
      inFlight=true;
      const window=!current.obsInput?.sourceId&&current.settings.mode==='live'?temporal.current.window(Date.now()):undefined,requestedAt=Date.now(),requestSpeechVersion=speechVersion;
      try{const result=await api<{ok?:boolean;skipped?:string;transcriptionNeedsReview?:boolean}>('react',{video:window,...(current.settings.mode==='live'&&current.obsInput?.sourceId?{obsSourceId:current.obsInput.sourceId}:{})});
        if(window&&((result.ok&&!result.transcriptionNeedsReview)||['unchanged-input','stale-screen'].includes(result.skipped||'')))temporal.current.acknowledge(window);
        if(result.ok||['unchanged-input','stale-screen'].includes(result.skipped||'')){answeredVersion=requestSpeechVersion;nextAttemptAt=requestedAt+current.settings.intervalSeconds*1000;}
        else nextAttemptAt=Date.now()+1500;
        if(result.transcriptionNeedsReview&&!disposed)errorRef.current('음성을 확실하게 이해하지 못했어요. 마지막 말을 다시 들려주세요.');}
      catch(e){if(!disposed)errorRef.current(e instanceof Error?e.message:'관객 응답 실패');}
      finally{inFlight=false;}
    };
    wake.current=()=>void tick();void tick();const timer=setInterval(()=>void tick(),1500);return()=>{disposed=true;wake.current=()=>{};clearInterval(timer);};
  },[state?.running,state?.sessionId]);
  useEffect(()=>{if(state){if(wasRunning.current&&!state.running)stopAll();wasRunning.current=state.running;}},[state?.running]);
  useEffect(()=>()=>{epoch.current++;micPreparation.current?.abort();micPreparation.current=null;speechQueue.current?.reset();pendingSpeech.current.clear();temporal.current.reset();captureEpoch.current++;capturePreparation.current?.abort();capturePreparation.current=null;screenStream.current?.getTracks().forEach(t=>t.stop());if(captureVideo.current){captureVideo.current.pause();captureVideo.current.srcObject=null;}recording.current=false;micStream.current?.getTracks().forEach(t=>t.stop());void context.current?.close();},[]);
  return {video,sharing,capturePreparing,cancelCapture,soundSharing:!!outputStream,soundStatus:sound.status,soundLevel:sound.level,stopSound,mic,micPreparing,level,transcript,delivery,share,stopScreen,startMic,stopMic,stopAll,say,clipBuffering:clips.buffering};
}

import {useEffect,useRef,useState} from 'react';
import {useSystemSound} from './useSystemSound';
import {api} from './api';
import type {State} from './types';
import {useClipBuffer} from './useClipBuffer';
import {VoiceBoundary,SpeechQueue,SpeechOutbox,VOICE_MAX_MS} from './speech-flow';

export function useMedia(state:State|null,onError:(s:string)=>void){
  const video=useRef<HTMLVideoElement>(null),screenStream=useRef<MediaStream|null>(null),micStream=useRef<MediaStream|null>(null);
  const captureVideo=useRef<HTMLVideoElement|null>(null),wasRunning=useRef(false),captureEpoch=useRef(0),acquiringMic=useRef(false);
  const [sharing,setSharing]=useState(false),[mic,setMic]=useState(false),[level,setLevel]=useState(0),[transcript,setTranscript]=useState(''),[delivery,setDelivery]=useState('');
  const recording=useRef(false),recorder=useRef<MediaRecorder|null>(null),context=useRef<AudioContext|null>(null);
  const stateRef=useRef(state);stateRef.current=state;const pendingSpeech=useRef(new SpeechOutbox());const epoch=useRef(0),wake=useRef<()=>void>(()=>{});
  const speechQueue=useRef<SpeechQueue<Blob,{text:string;cues?:{delivery?:string}}>|null>(null);
  const errorRef=useRef(onError);errorRef.current=onError;
  const [outputStream,setOutputStream]=useState<MediaStream|null>(null),[picture,setPicture]=useState(true);const pictureRef=useRef(true);
  const sound=useSystemSound(outputStream,state?.running&&state.settings.mode==='live'?state.sessionId:null,message=>{stopSound();errorRef.current(message);});
  const clips=useClipBuffer(picture?screenStream.current:null,micStream.current,!!state?.running&&!!state?.settings.clipBufferEnabled,state?.sessionId || null,outputStream);
  useEffect(()=>{const v=video.current;if(v&&screenStream.current&&v.srcObject!==screenStream.current){v.srcObject=screenStream.current;void v.play().catch(()=>{});}});
  function stopSound(){screenStream.current?.getAudioTracks().forEach(t=>t.stop());setOutputStream(null);}
  function stopScreen(){captureEpoch.current++;stopSound();screenStream.current?.getTracks().forEach(t=>t.stop());screenStream.current=null;setSharing(false);if(video.current)video.current.srcObject=null;if(captureVideo.current)captureVideo.current.srcObject=null;captureVideo.current=null;}
  function stopMic(){epoch.current++;recording.current=false;speechQueue.current?.reset();speechQueue.current=null;if(recorder.current?.state==='recording')recorder.current.stop();micStream.current?.getTracks().forEach(t=>t.stop());micStream.current=null;void context.current?.close();context.current=null;setMic(false);setLevel(0);}
  function stopAll(){stopScreen();stopMic();pendingSpeech.current.clear();}
  async function share(sourceId?:string,options={systemAudio:false,picture:true}){
    const ticket=++captureEpoch.current;
    try{if(sourceId&&window.backseat)await window.backseat.selectSource(sourceId,options.systemAudio);
      if(ticket!==captureEpoch.current)return;
      const stream=await navigator.mediaDevices.getDisplayMedia({video:{frameRate:15},audio:options.systemAudio?{echoCancellation:false,noiseSuppression:false,autoGainControl:false,restrictOwnAudio:true} as MediaTrackConstraints:false});
      if(ticket!==captureEpoch.current){stream.getTracks().forEach(t=>t.stop());return;}
      screenStream.current?.getTracks().forEach(t=>t.stop());screenStream.current=stream;pictureRef.current=options.picture;setPicture(options.picture);setOutputStream(stream.getAudioTracks().length?stream:null);if(options.systemAudio&&!stream.getAudioTracks().length)errorRef.current('Windows 출력 소리를 받지 못했습니다. 소리 연결을 다시 선택해주세요.');for(const track of stream.getAudioTracks())track.onended=()=>{if(screenStream.current===stream)stopSound();};
      const capture=document.createElement('video');capture.muted=true;capture.srcObject=stream;captureVideo.current=capture;await capture.play();
      if(ticket!==captureEpoch.current)return;
      // The tab's preview can disappear while play() is pending. Only the
      // independent capture player owns sharing; preview teardown is harmless.
      const v=video.current;if(v){v.srcObject=stream;void v.play().catch(()=>{});}if(ticket!==captureEpoch.current)return;setSharing(options.picture);stream.getVideoTracks()[0].onended=()=>{if(screenStream.current===stream)stopScreen();};
    }catch(e){if(ticket===captureEpoch.current){stopScreen();errorRef.current(e instanceof Error?e.message:'화면 공유를 시작하지 못했습니다.');}}
  }
  function frame(){const v=captureVideo.current;if(!pictureRef.current||!screenStream.current||!v?.videoWidth)return undefined;const canvas=document.createElement('canvas');canvas.width=Math.min(1280,v.videoWidth);canvas.height=Math.round(v.videoHeight*canvas.width/v.videoWidth);canvas.getContext('2d')!.drawImage(v,0,0,canvas.width,canvas.height);return canvas.toDataURL('image/jpeg',0.65);}
  function say(text:string,source:'keyboard'|'microphone'='keyboard'){const s=stateRef.current;if(!s?.running){errorRef.current('방송을 먼저 시작해주세요.');return;}if(!pendingSpeech.current.add(text,s.sessionId,source)){errorRef.current('전달할 말이 많이 밀렸어요. 관객 응답 후 마지막 말을 다시 입력해주세요.');return;}wake.current();}
  const attachedClips=useRef(new Set<string>());
  useEffect(()=>{
    if(!state?.running||!state.settings.autoHighlights||!state.settings.clipBufferEnabled)return;
    for(const clip of state.clips){
      if(clip.source!=='spectator'||clip.sessionId!==state.sessionId||clip.video||attachedClips.current.has(clip.id)||Date.now()-clip.createdAt>120000)continue;
      attachedClips.current.add(clip.id);
      void (async()=>{try{
        const recording=await clips.takeAt(clip.observedAt||clip.createdAt);
        if(!recording||!screenStream.current||!stateRef.current?.running||stateRef.current.sessionId!==recording.sessionId||!stateRef.current.settings.clipBufferEnabled)return;
        const params=new URLSearchParams({startedAt:String(recording.startedAt),endedAt:String(recording.endedAt),hasAudio:String(recording.hasAudio)});
        const response=await fetch(`/api/clips/${clip.id}/video?${params}`,{method:'POST',headers:{'Content-Type':'video/webm','X-Backseat-Client':'studio'},body:recording.blob});
        if(!response.ok)throw new Error((await response.json()).error+' · 관객의 장면 기록은 저장되어 있습니다.');
      }catch(error){errorRef.current(error instanceof Error?error.message:'관객 클립 영상 연결 실패');}})();
    }
  },[state?.clips,state?.running,state?.settings.autoHighlights,state?.settings.clipBufferEnabled]);
  async function startMic(){
    if(acquiringMic.current||micStream.current)return;
    if(!stateRef.current?.running||stateRef.current.settings.mode!=='live'){errorRef.current('실제 AI 방송을 시작한 뒤 마이크를 켜주세요.');return;}
    acquiringMic.current=true;const generation=++epoch.current;
    try{
      const stream=await navigator.mediaDevices.getUserMedia({audio:{echoCancellation:true,noiseSuppression:true,autoGainControl:true},video:false});
      if(generation!==epoch.current||!stateRef.current?.running){stream.getTracks().forEach(t=>t.stop());return;}micStream.current=stream;
      const ctx=new AudioContext();context.current=ctx;const source=ctx.createMediaStreamSource(stream);const analyser=ctx.createAnalyser();analyser.fftSize=512;source.connect(analyser);
      recording.current=true;setMic(true);
      const mime=MediaRecorder.isTypeSupported('audio/webm;codecs=opus')?'audio/webm;codecs=opus':'audio/mp4';
      const queue=new SpeechQueue<Blob,{text:string;cues?:{delivery?:string}}>({
        execute:async(blob,signal)=>{const res=await fetch('/api/audio',{method:'POST',headers:{'Content-Type':mime,'X-Backseat-Client':'studio'},body:blob,signal});const result=await res.json();if(!res.ok)throw new Error(result.error);return result;},
        onResult:result=>{if(generation===epoch.current&&recording.current&&result.text){setTranscript(result.text);setDelivery(result.cues?.delivery||'');say(result.text,'microphone');}},
        onError:e=>{if(generation===epoch.current)errorRef.current(e instanceof Error?e.message:'음성 인식 실패');}
      });speechQueue.current=queue;
      function segment(){
        if(!recording.current||generation!==epoch.current)return;
        const rec=new MediaRecorder(stream,{mimeType:mime});recorder.current=rec;const parts:BlobPart[]=[];const boundary=new VoiceBoundary(performance.now());
        const samples=new Float32Array(analyser.fftSize);
        const meter=setInterval(()=>{analyser.getFloatTimeDomainData(samples);const rms=Math.sqrt(samples.reduce((a,b)=>a+b*b,0)/samples.length);setLevel(Math.min(1,rms*8));if(boundary.sample(rms,performance.now())&&rec.state==='recording')rec.stop();},50);
        rec.ondataavailable=e=>{if(e.data.size)parts.push(e.data);};
        rec.onstop=()=>{clearInterval(meter);clearTimeout(timer);if(generation!==epoch.current||!recording.current)return;segment();if(!boundary.hasSpeech||!parts.length)return;
          if(!queue.enqueue(new Blob(parts,{type:mime}))){stopMic();errorRef.current('음성 처리가 계속 밀려 마이크를 멈췄어요. 대기 중이던 말은 취소되었습니다. 잠시 후 마이크를 켜고 마지막 말을 다시 들려주세요.');}
        };
        rec.onerror=()=>{if(generation===epoch.current){stopMic();errorRef.current('마이크 녹음을 이어갈 수 없습니다. 입력 장치를 확인하고 다시 켜주세요.');}};
        rec.start();const timer=setTimeout(()=>{if(rec.state==='recording')rec.stop();},VOICE_MAX_MS);
      }
      segment();
    }catch(e){stopMic();errorRef.current(e instanceof Error?e.message:'마이크를 시작하지 못했습니다.');}finally{acquiringMic.current=false;}
  }
  useEffect(()=>{
    if(!state?.running)return;let disposed=false,inFlight=false;const session=state.sessionId;
    const tick=async()=>{
      const s=stateRef.current;if(disposed||!s?.running||s.sessionId!==session)return;
      try{await pendingSpeech.current.flush(async(item,signal)=>{const response=await fetch('/api/speech',{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify(item),signal});const result=await response.json();if(!response.ok)throw new Error(result.error||'발언을 전달하지 못했습니다.');return result;});}
      catch(e){if(!disposed)errorRef.current(e instanceof Error?e.message:'발언 전달 실패 · 다시 시도하고 있습니다.');return;}
      const current=stateRef.current;if(disposed||pendingSpeech.current.items.length||inFlight||!current?.running||current.sessionId!==session||current.busy||current.calls>=current.settings.maxCalls)return;
      inFlight=true;
      try{const result=await api<{skipped?:string;transcriptionNeedsReview?:boolean}>('react',{image:current.settings.mode==='live'?frame():undefined});if(result.transcriptionNeedsReview&&!disposed)errorRef.current('음성을 확실하게 이해하지 못했어요. 마지막 말을 다시 들려주세요.');}
      catch(e){if(!disposed)errorRef.current(e instanceof Error?e.message:'관객 응답 실패');}
      finally{inFlight=false;}
    };
    wake.current=()=>void tick();void tick();const timer=setInterval(()=>void tick(),1500);return()=>{disposed=true;wake.current=()=>{};clearInterval(timer);};
  },[state?.running,state?.sessionId]);
  useEffect(()=>{if(state){if(wasRunning.current&&!state.running)stopAll();wasRunning.current=state.running;}},[state?.running]);
  useEffect(()=>()=>{epoch.current++;speechQueue.current?.reset();pendingSpeech.current.clear();captureEpoch.current++;screenStream.current?.getTracks().forEach(t=>t.stop());recording.current=false;micStream.current?.getTracks().forEach(t=>t.stop());void context.current?.close();},[]);
  return {video,sharing,soundSharing:!!outputStream,soundStatus:sound.status,soundLevel:sound.level,stopSound,mic,level,transcript,delivery,share,stopScreen,startMic,stopMic,stopAll,say,clipBuffering:clips.buffering};
}

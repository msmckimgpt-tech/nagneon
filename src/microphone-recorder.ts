import {VoiceBoundary,VOICE_MAX_MS,type SpeechCapture} from './speech-flow.ts';

type TimerHandle=ReturnType<typeof globalThis.setTimeout>;
type RecorderClock={
  now:()=>number;
  wallNow:()=>number;
  setTimeout:(callback:()=>void,ms:number)=>TimerHandle;
  clearTimeout:(handle:TimerHandle)=>void;
  setInterval:(callback:()=>void,ms:number)=>TimerHandle;
  clearInterval:(handle:TimerHandle)=>void;
};

const defaultClock:RecorderClock={
  now:()=>performance.now(),
  wallNow:()=>Date.now(),
  setTimeout:(callback,ms)=>globalThis.setTimeout(callback,ms),
  clearTimeout:handle=>globalThis.clearTimeout(handle),
  setInterval:(callback,ms)=>globalThis.setInterval(callback,ms) as TimerHandle,
  clearInterval:handle=>globalThis.clearInterval(handle),
};

function asError(error:unknown,message:string){return error instanceof Error?error:new Error(message);}

export function startMicrophoneRecorder(options:{
  stream:MediaStream;
  analyser:AnalyserNode;
  mimeType:string;
  active:()=>boolean;
  onLevel:(level:number)=>void;
  onSegment:(blob:Blob,capture?:SpeechCapture)=>void;
  attachScreen?:(capture:SpeechCapture)=>void;
  onFailure:(error:Error)=>void;
  stopEventTimeoutMs?:number;
  recorderFactory?:(stream:MediaStream,mimeType:string)=>MediaRecorder;
  clock?:RecorderClock;
}){
  const clock=options.clock??defaultClock,stopEventTimeoutMs=options.stopEventTimeoutMs??2000;
  const recorderFactory=options.recorderFactory??((stream,mimeType)=>new MediaRecorder(stream,{mimeType}));
  let disposed=false,current:MediaRecorder|null=null,disposeSegment=()=>{};

  const fail=(error:unknown,message='마이크 녹음을 이어갈 수 없습니다.')=>{
    if(disposed)return;
    disposed=true;
    disposeSegment();
    options.onFailure(asError(error,message));
  };

  const begin=()=>{
    if(disposed||!options.active())return;
    const rec=recorderFactory(options.stream,options.mimeType);
    current=rec;
    const parts:BlobPart[]=[],boundary=new VoiceBoundary(clock.now()),wallStartedAt=clock.wallNow(),samples=new Float32Array(options.analyser.fftSize);
    let finalized=false,stopRequested=false,meter:TimerHandle|undefined,cap:TimerHandle|undefined,stopWatch:TimerHandle|undefined;
    const clearTimers=()=>{
      if(meter!==undefined){clock.clearInterval(meter);meter=undefined;}
      if(cap!==undefined){clock.clearTimeout(cap);cap=undefined;}
      if(stopWatch!==undefined){clock.clearTimeout(stopWatch);stopWatch=undefined;}
    };
    const disposeThis=()=>{
      if(finalized)return;
      finalized=true;clearTimers();if(current===rec)current=null;
      if(rec.state==='recording'){try{rec.stop();}catch{}}
    };
    disposeSegment=disposeThis;
    const finish=(missingStopEvent=false)=>{
      if(finalized)return;
      finalized=true;clearTimers();if(current===rec)current=null;
      if(disposed||!options.active())return;
      let restartError:unknown;
      try{begin();}catch(error){restartError=error;}
      if(!missingStopEvent&&boundary.hasSpeech&&parts.length){
        const capture=boundary.capture(wallStartedAt);if(capture)options.attachScreen?.(capture);
        options.onSegment(new Blob(parts,{type:options.mimeType}),capture);
      }
      if(restartError!==undefined)fail(restartError);
    };
    const requestStop=()=>{
      if(finalized||stopRequested||rec.state!=='recording')return;
      stopRequested=true;
      if(meter!==undefined){clock.clearInterval(meter);meter=undefined;}
      if(cap!==undefined){clock.clearTimeout(cap);cap=undefined;}
      try{rec.stop();}catch(error){fail(error);return;}
      if(!finalized)stopWatch=clock.setTimeout(()=>finish(true),stopEventTimeoutMs);
    };
    rec.ondataavailable=event=>{if(!finalized&&event.data.size)parts.push(event.data);};
    rec.onstop=()=>finish(false);
    rec.onerror=()=>fail(new Error('마이크 녹음기가 오류로 중단되었습니다.'));
    try{rec.start();}catch(error){finalized=true;clearTimers();if(current===rec)current=null;throw error;}
    meter=clock.setInterval(()=>{
      if(finalized||disposed||!options.active())return requestStop();
      try{
        options.analyser.getFloatTimeDomainData(samples);
        const rms=Math.sqrt(samples.reduce((sum,value)=>sum+value*value,0)/samples.length);
        options.onLevel(Math.min(1,rms*8));
        if(boundary.sample(rms,clock.now()))requestStop();
      }catch(error){fail(error,'마이크 음량을 측정할 수 없습니다.');}
    },50);
    cap=clock.setTimeout(requestStop,VOICE_MAX_MS);
  };

  try{begin();}catch(error){disposed=true;disposeSegment();throw error;}
  return ()=>{
    if(disposed)return;
    disposed=true;
    disposeSegment();
    current=null;
  };
}

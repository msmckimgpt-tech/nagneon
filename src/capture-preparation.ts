export type CapturePhase='source'|'frame';
type PreparedCapture={stream:MediaStream;video:HTMLVideoElement};
const aborted=()=>new DOMException('화면 연결을 취소했습니다.','AbortError');
export function releaseCapture({stream,video}:PreparedCapture){
  video.pause();video.srcObject=null;stream.getTracks().forEach(track=>track.stop());
}

// getDisplayMedia cannot be cancelled through AbortSignal. Settle our attempt
// promptly, and retain ownership of any stream that arrives after cancellation.
export function prepareCapture({acquire,signal,onPhase,picture=true,createVideo=()=>document.createElement('video'),acquisitionTimeoutMs=30000,frameTimeoutMs=15000}:{
  acquire:()=>Promise<MediaStream>;signal:AbortSignal;onPhase:(phase:CapturePhase)=>void;
  picture?:boolean;createVideo?:()=>HTMLVideoElement;acquisitionTimeoutMs?:number;frameTimeoutMs?:number;
}):Promise<PreparedCapture>{
  return new Promise((resolve,reject)=>{
    let settled=false,stream:MediaStream|undefined,video:HTMLVideoElement|undefined,playing=false,timer:ReturnType<typeof setTimeout>|undefined;
    const cleanups:(()=>void)[]=[];
    const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',cancel);cleanups.splice(0).forEach(fn=>fn());};
    const fail=(error:unknown)=>{if(settled)return;settled=true;cleanup();if(stream){if(video)releaseCapture({stream,video});else stream.getTracks().forEach(t=>t.stop());}reject(error);};
    const cancel=()=>fail(aborted());
    const listen=(target:EventTarget,name:string,fn:()=>void)=>{target.addEventListener(name,fn);cleanups.push(()=>target.removeEventListener(name,fn));};
    const ended=()=>fail(new Error('선택한 화면이 연결 준비 중에 닫혔습니다. 다시 선택해주세요.'));
    const ready=()=>{
      if(settled||!video||!stream||!playing||video.readyState<2||!video.videoWidth||!video.videoHeight)return;
      if(stream.getVideoTracks()[0]?.readyState!=='live'){ended();return;}
      settled=true;cleanup();resolve({stream,video});
    };
    signal.addEventListener('abort',cancel,{once:true});
    if(signal.aborted){cancel();return;}
    onPhase('source');
    // The browser's own chooser may remain open until the user decides. The
    // desktop path already has an explicit source and uses a bounded wait.
    if(acquisitionTimeoutMs>0)timer=setTimeout(()=>fail(new Error('선택한 화면에 연결하지 못했습니다. 창이 열려 있는지 확인하고 다시 선택해주세요.')),acquisitionTimeoutMs);
    let acquisition:Promise<MediaStream>;
    try{acquisition=acquire();}catch(error){fail(error);return;}
    void Promise.resolve(acquisition).then(value=>{
      if(settled){value.getTracks().forEach(t=>t.stop());return;}
      stream=value;clearTimeout(timer);
      const track=stream.getVideoTracks()[0];if(!track||track.readyState!=='live'){ended();return;}
      listen(track,'ended',ended);
      try{
        video=createVideo();video.muted=true;video.playsInline=true;
        if(!picture){
          if(!stream.getAudioTracks().some(t=>t.readyState==='live'))throw new Error('Windows 출력 소리를 받지 못했습니다. 소리 연결을 다시 선택해주세요.');
          // Sound-only sharing does not need to decode an unseen game frame.
          settled=true;cleanup();resolve({stream,video});return;
        }
        listen(video,'error',()=>fail(new Error('선택한 화면을 재생하지 못했습니다. 다시 선택해주세요.')));
        for(const event of ['loadeddata','resize','playing'])listen(video,event,ready);
        onPhase('frame');timer=setTimeout(()=>fail(new Error('첫 화면을 15초 안에 받지 못했습니다. 게임 창을 표시한 뒤 다시 연결해주세요.')),frameTimeoutMs);
        video.srcObject=stream;
        void Promise.resolve(video.play()).then(()=>{playing=true;ready();},fail);
      }catch(error){fail(error);}
    },fail);
  });
}

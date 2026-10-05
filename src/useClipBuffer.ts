import {useEffect,useRef,useState} from 'react';
import {createSeparatedClipSources} from './clip-source';
import {ClipBuffer} from './clip-buffer';

export function useClipBuffer(screen:MediaStream|null,mic:MediaStream|null,enabled:boolean,sessionId:string|null,system:MediaStream|null=null,onError?:(message:string)=>void){
  const current=useRef<ClipBuffer|null>(null);
  const voice=useRef<ClipBuffer|null>(null),layout=useRef<'separate'|'microphone-only'>('separate');
  const [buffering,setBuffering]=useState(false);
  const errorRef=useRef(onError);errorRef.current=onError;
  useEffect(()=>{
    setBuffering(false);
    if(!enabled||!sessionId)return;
    let release=()=>{},failed=false;
    const report=(message:string)=>{if(failed)return;failed=true;current.current=null;voice.current=null;setBuffering(false);errorRef.current?.(message+' 화면·마이크 연결을 다시 시도해주세요. 사진·대화 기록은 방송 밖 이야기에 남습니다.');};
    try{
      const source=createSeparatedClipSources(screen,mic,system);if(!source){if([screen,mic,system].some(s=>s?.getTracks().some(t=>t.readyState==='live')))report('영상·음성 클립 녹화를 시작하지 못했습니다.');return;}
      release=source.close;
      const fail=()=>{buffer.dispose();voiceBuffer?.dispose();release();report('영상·음성 클립 녹화가 중단되었습니다.');};
      const buffer=new ClipBuffer({sessionId,hasAudio:source.base.hasAudio,kind:source.base.kind,
        create:()=>new MediaRecorder(source.base.stream,source.base.recorderOptions),onFailure:fail});
      const voiceSource=source.voice;
      const voiceBuffer=voiceSource?new ClipBuffer({sessionId,hasAudio:true,kind:'audio',create:()=>new MediaRecorder(voiceSource.stream,voiceSource.recorderOptions),onFailure:fail}):null;
      current.current=buffer;voice.current=voiceBuffer;layout.current=source.audioLayout;setBuffering(true);buffer.start();voiceBuffer?.start();
      return()=>{buffer.dispose();voiceBuffer?.dispose();if(current.current===buffer){current.current=null;voice.current=null;}release();setBuffering(false);};
    }catch{current.current?.dispose();voice.current?.dispose();release();report('영상·음성 클립 녹화를 준비하지 못했습니다.');}
  },[screen,mic,enabled,sessionId,system]);
  return {buffering,takeAt:async(at:number)=>{const base=current.current,voiceBuffer=voice.current,audioLayout=layout.current;if(!base)return null;const [clip,micClip]=await Promise.all([base.takeAt(at),voiceBuffer?.takeAt(at)||Promise.resolve(null)]);if(!clip||current.current!==base)return null;return {...clip,audioLayout,...(micClip?{voice:micClip}:{})};}};
}

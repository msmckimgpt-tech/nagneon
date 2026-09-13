import {useEffect,useRef,useState} from 'react';
import {createSeparatedClipSources} from './clip-source';
import {ClipBuffer} from './clip-buffer';

export function useClipBuffer(screen:MediaStream|null,mic:MediaStream|null,enabled:boolean,sessionId:string|null,system:MediaStream|null=null){
  const current=useRef<ClipBuffer|null>(null);
  const voice=useRef<ClipBuffer|null>(null),layout=useRef<'separate'|'microphone-only'>('separate');
  const [buffering,setBuffering]=useState(false);
  useEffect(()=>{
    setBuffering(false);
    if(!enabled||!sessionId)return;
    let release=()=>{};
    try{
      const source=createSeparatedClipSources(screen,mic,system);if(!source)return;
      release=source.close;
      const fail=()=>{buffer.dispose();voiceBuffer?.dispose();release();setBuffering(false);};
      const buffer=new ClipBuffer({sessionId,hasAudio:source.base.hasAudio,kind:source.base.kind,
        create:()=>new MediaRecorder(source.base.stream,source.base.recorderOptions),onFailure:fail});
      const voiceSource=source.voice;
      const voiceBuffer=voiceSource?new ClipBuffer({sessionId,hasAudio:true,kind:'audio',create:()=>new MediaRecorder(voiceSource.stream,voiceSource.recorderOptions),onFailure:fail}):null;
      current.current=buffer;voice.current=voiceBuffer;layout.current=source.audioLayout;setBuffering(true);buffer.start();voiceBuffer?.start();
      return()=>{buffer.dispose();voiceBuffer?.dispose();if(current.current===buffer){current.current=null;voice.current=null;}release();setBuffering(false);};
    }catch{release();setBuffering(false);}
  },[screen,mic,enabled,sessionId,system]);
  return {buffering,takeAt:async(at:number)=>{const base=current.current,voiceBuffer=voice.current,audioLayout=layout.current;if(!base)return null;const [clip,micClip]=await Promise.all([base.takeAt(at),voiceBuffer?.takeAt(at)||Promise.resolve(null)]);if(!clip||current.current!==base)return null;return {...clip,audioLayout,...(micClip?{voice:micClip}:{})};}};
}

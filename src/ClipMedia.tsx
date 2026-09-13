import {useEffect,useRef,useState,type SyntheticEvent} from 'react';
import type {ClipSummary} from './HotClips';
import {voicePlaybackTime} from './clip-playback.ts';

export function ClipMedia({clip}:{clip:Pick<ClipSummary,'id'|'video'|'audio'|'thumbnail'|'voice'|'audioLayout'|'videoStartedAt'|'audioStartedAt'|'voiceStartedAt'|'voiceEndedAt'>}){
  if(clip.video||clip.audio)return <ClipPlayer key={clip.id} clip={clip}/>;
  if(clip.thumbnail)return <img src={`/api/clips/${clip.id}/media/thumbnail`} alt="저장한 방송 장면"/>;
  return null;
}
function ClipPlayer({clip}:Parameters<typeof ClipMedia>[0]){
  const mic=useRef<HTMLAudioElement|null>(null),main=useRef<HTMLMediaElement|null>(null),[voiceOn,setVoiceOn]=useState(true),[voiceError,setVoiceError]=useState('');
  const playPending=useRef(false),failed=useRef(false);
  useEffect(()=>{const audio=mic.current;return()=>audio?.pause();},[clip.id,clip.voice]);
  const separate=!!clip.voice&&Number.isFinite(clip.voiceStartedAt)&&Number.isFinite(clip.voiceEndedAt),voiceOnly=clip.audioLayout==='microphone-only';
  function sync(media:HTMLMediaElement,enabled=voiceOn,seek=false){
    const audio=mic.current;if(!audio||failed.current)return;
    audio.volume=media.volume;audio.muted=!enabled||media.muted;audio.playbackRate=media.playbackRate;
    const pos=voicePlaybackTime(media.currentTime,(clip.video?clip.videoStartedAt:clip.audioStartedAt)??0,clip.voiceStartedAt!,clip.voiceEndedAt!);
    if(pos===null||media.paused||media.ended||media.seeking||media.readyState<2||!enabled){audio.pause();return;}
    if(audio.readyState<1)return;
    if(seek||Math.abs(audio.currentTime-pos)>.15)audio.currentTime=pos;
    if(audio.paused&&!playPending.current){playPending.current=true;void audio.play().catch(error=>{if(error?.name==='AbortError')return;audio.pause();failed.current=true;setVoiceError('마이크 음성을 재생하지 못했습니다. 음성 켜기를 다시 눌러주세요.');}).finally(()=>{playPending.current=false;});}
  }
  const events={onPlay:(e:SyntheticEvent<HTMLMediaElement>)=>sync(e.currentTarget,voiceOn,true),onPlaying:(e:SyntheticEvent<HTMLMediaElement>)=>sync(e.currentTarget,voiceOn,true),onWaiting:()=>mic.current?.pause(),onPause:()=>mic.current?.pause(),onEnded:()=>mic.current?.pause(),onSeeking:()=>mic.current?.pause(),onSeeked:(e:SyntheticEvent<HTMLMediaElement>)=>sync(e.currentTarget,voiceOn,true),onTimeUpdate:(e:SyntheticEvent<HTMLMediaElement>)=>sync(e.currentTarget),onRateChange:(e:SyntheticEvent<HTMLMediaElement>)=>sync(e.currentTarget),onVolumeChange:(e:SyntheticEvent<HTMLMediaElement>)=>sync(e.currentTarget)};
  if(clip.video||clip.audio)return <div className="clip-playback" key={clip.id}>
    {clip.video?<video ref={el=>{main.current=el;}} aria-label="관객이 남긴 영상 클립" controls preload="metadata" src={`/api/clips/${clip.id}/media/video`} {...events}/>:<audio ref={el=>{main.current=el;}} aria-label="관객이 남긴 음성 클립" controls preload="metadata" muted={voiceOnly&&!voiceOn} src={`/api/clips/${clip.id}/media/audio`} {...events}/>}
    {separate&&<audio ref={mic} preload="metadata" src={`/api/clips/${clip.id}/media/voice`} onLoadedMetadata={()=>{if(main.current)sync(main.current,voiceOn,true);}} onError={()=>{failed.current=true;setVoiceError('저장된 마이크 음성을 불러오지 못했습니다.');}} hidden/>}
    {(separate||voiceOnly)?<button className="secondary" aria-pressed={voiceOn} onClick={()=>{const enabled=!voiceOn;setVoiceOn(enabled);setVoiceError('');failed.current=false;if(enabled&&mic.current?.error)mic.current.load();if(main.current)sync(main.current,enabled,true);}}>스트리머 음성 {voiceOn?'켜짐':'꺼짐'}</button>:<small className="field-note">{clip.audioLayout==='separate'?'이 클립에는 분리된 스트리머 음성이 없습니다.':'기존에 혼합 저장한 소리는 스트리머 음성만 분리할 수 없습니다.'}</small>}
    {voiceError&&<p role="status">{voiceError}</p>}
  </div>;
  if(clip.thumbnail)return <img src={`/api/clips/${clip.id}/media/thumbnail`} alt="저장한 방송 장면"/>;
  return null;
}

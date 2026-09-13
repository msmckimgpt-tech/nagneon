// Media timestamps share a capture clock; sidecar playback uses its own offset.
export function voicePlaybackTime(position:number,baseStartedAt:number,voiceStartedAt:number,voiceEndedAt:number){
  const time=position+(baseStartedAt-voiceStartedAt)/1000;
  return time>=0&&time<(voiceEndedAt-voiceStartedAt)/1000?time:null;
}

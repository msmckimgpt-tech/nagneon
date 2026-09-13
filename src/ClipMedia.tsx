import type {ClipSummary} from './HotClips';

export function ClipMedia({clip}:{clip:Pick<ClipSummary,'id'|'video'|'audio'|'thumbnail'>}){
  if(clip.video)return <video key={clip.id} aria-label="관객이 남긴 영상 클립" controls preload="metadata" src={`/api/clips/${clip.id}/media/video`}/>;
  if(clip.audio)return <audio key={clip.id} aria-label="관객이 남긴 음성 클립" controls preload="metadata" src={`/api/clips/${clip.id}/media/audio`}/>;
  if(clip.thumbnail)return <img src={`/api/clips/${clip.id}/media/thumbnail`} alt="저장한 방송 장면"/>;
  return null;
}

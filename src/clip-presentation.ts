import type {ClipSummary} from './HotClips';

export const isPlayableClip=(clip:Pick<ClipSummary,'video'|'audio'>)=>!!(clip.video||clip.audio);

// A projection keeps the original attachment, comments and provenance in one
// store. Moving a record between screens must not duplicate or erase history.
export function sceneRecordPosts(clips:ClipSummary[]){
  return clips.filter(clip=>!isPlayableClip(clip)).map(clip=>({
    id:clip.id,recordId:clip.id,title:clip.title,category:'장면 기록',
    name:clip.creator?.name||'방송 기록',text:clip.scene,time:clip.createdAt,
    kind:clip.creator?'ai':'streamer',votes:clip.votes||[],commentCount:clip.commentCount,
  }));
}

import {createHash} from 'node:crypto';

export const SCREEN_REACTION_TTL_MS=45000;
// Session-local input continuity, not event recognition or a second transcript.
// Hashes are never sent to the model or persisted. Changed pixels alone do not
// prove a new achievement; identical bytes can safely avoid another analysis.
export class ViewingContinuity {
  constructor(){this.reset();}
  reset(){this.last=null;this.checkedAt=0;this.viewers=new Map();this.heard=new Set();this.discussed=new Set();this.motion=new Set();}
  observe({image,frames=[],screenTimeline,people=[],soundIds=[],peerIds=[],scope='',at}){
    const fingerprint=image?createHash('sha256').update(image).digest('hex'):null;
    // The endpoint can be identical after an intervening jump/failure. Include
    // unseen transitions, but ignore overlapping frames already acknowledged.
    const motionIds=frames.flatMap((f,i)=>i&&!screenTimeline?.frames[i]?.alreadyObserved&&f.image!==frames[i-1].image?[`${screenTimeline?.sourceId}:${f.at}:${createHash('sha256').update(f.image).digest('hex')}`]:[]);
    const newMotion=motionIds.some(id=>!this.motion.has(id));
    scope+=':'+ (screenTimeline?.sourceId||'');
    const present=new Set(people.map(p=>p.id));
    for(const id of this.viewers.keys())if(!present.has(id))this.viewers.delete(id);
    const timing={};
    for(const p of people){
      const previous=this.viewers.get(p.id);
      const same=!newMotion&&!!fingerprint&&previous?.fingerprint===fingerprint&&previous.joinedAt===p.joinedAt&&previous.scope===scope&&previous.at<=at;
      const since=same?previous.since:at;
      this.viewers.set(p.id,{fingerprint,since,at,joinedAt:p.joinedAt,scope});
      timing[p.id]={receivedAt:at,hasImage:!!fingerprint,sameImageAsPreviousSample:!!same,imageUnchangedSeconds:fingerprint?Math.max(0,Math.floor((at-since)/1000)):0};
    }
    const key=JSON.stringify([scope,fingerprint,people.map(p=>[p.id,p.joinedAt]).sort((a,b)=>a[0].localeCompare(b[0]))]);
    const ticket={at,key,soundIds:[...new Set(soundIds)].slice(-40),peerIds:[...new Set(peerIds)].slice(-40),motionIds,timing,video:screenTimeline?{sourceId:screenTimeline.sourceId,through:screenTimeline.through}:null};this.checkedAt=at;
    return ticket;
  }
  sameExternalInput(ticket){return !!ticket&&!!this.last&&ticket.at>=this.last.at&&ticket.key===this.last.key&&ticket.soundIds.every(id=>this.heard.has(id))&&ticket.motionIds.every(id=>this.motion.has(id));}
  unchanged(ticket){return this.sameExternalInput(ticket)&&ticket.peerIds.every(id=>this.discussed.has(id));}
  acknowledge(ticket){this.last={key:ticket.key,at:ticket.at,video:ticket.video};for(const [ids,seen] of [[ticket.soundIds,this.heard],[ticket.peerIds,this.discussed],[ticket.motionIds,this.motion]]){for(const id of ids)seen.add(id);while(seen.size>40)seen.delete(seen.values().next().value);}}
}

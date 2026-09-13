// Bounded local operational metadata. Never retain prompts, image/audio bytes,
// text, viewer identities, account data or provider error messages here.
const LIMIT=120;
const count=n=>Number.isFinite(n)?Math.max(0,Math.floor(n)):0;
const elapsed=(a,b)=>Math.max(0,b-a);
const reasons=new Set(['expired','absent','disabled','blocked','duplicate','spoiler','advice','pace','cleared','delivery-error']);
const outcomes=new Set(['accepted','stale-screen','stopped','superseded','episode-ended','transcription-review','error']);
const skips=new Set(['busy','audience-arrival','interval','backoff','older-window','unchanged-input','ended-screen','stale-screen','stopped','superseded','episode-ended']);
export class ReactionDiagnostics {
  constructor(now=Date.now){this.now=now;this.serial=0;this.reset();}
  reset(){this.since=this.now();this.rows=[];this.skips={};this.total=0;}
  begin({hasSpeech=false,frameCount=0,present=0,eligible=0,latestFrameAt}={}){
    const row={id:++this.serial,startedAt:this.now(),hasSpeech:!!hasSpeech,frameCount:count(frameCount),present:count(present),eligible:count(eligible),latestFrameAgeMs:Number.isFinite(latestFrameAt)?elapsed(latestFrameAt,this.now()):null,modelMs:null,generated:null,admitted:0,delivered:0,pending:0,rejected:{},state:'generating',firstDeliveryMs:null};
    this.rows.push(row);this.rows=this.rows.slice(-LIMIT);this.total++;return row.id;
  }
  row(id){return this.rows.find(row=>row.id===id);}
  generated(id,n){const row=this.row(id);if(!row)return;row.generated=count(n);row.modelMs=elapsed(row.startedAt,this.now());}
  reject(id,reason,n=1){const row=this.row(id);if(!row||!reasons.has(reason))return;row.rejected[reason]=(row.rejected[reason]||0)+count(n);}
  admit(id){const row=this.row(id);if(row){row.admitted++;row.pending++;}}
  drop(id,reason){const row=this.row(id);if(!row||row.pending<=0)return;row.pending--;this.reject(id,reason);}
  delivered(id){const row=this.row(id);if(!row||row.pending<=0)return;row.pending--;row.delivered++;row.firstDeliveryMs??=elapsed(row.startedAt,this.now());}
  finish(id,outcome){const row=this.row(id);if(!row)return;row.modelMs??=elapsed(row.startedAt,this.now());row.state=outcomes.has(outcome)?outcome:'error';row.finishedAt=this.now();}
  skip(reason){if(skips.has(reason))this.skips[reason]=(this.skips[reason]||0)+1;}
  snapshot(queue=[]){
    // Legacy moderation and special-mode transitions can clear the shared queue.
    // Account for removal without retaining a copy of a private chat payload.
    const pending=new Map();for(const m of queue)if(m.diagnosticId)pending.set(m.diagnosticId,(pending.get(m.diagnosticId)||0)+1);
    for(const row of this.rows){const left=pending.get(row.id)||0;if(row.pending>left){this.reject(row.id,'cleared',row.pending-left);row.pending=left;}}
    const rows=structuredClone(this.rows),latencies=rows.filter(r=>r.generated!==null).map(r=>r.modelMs).filter(Number.isFinite).sort((a,b)=>a-b);
    const summary={attempts:this.total,retained:rows.length,modelSilent:rows.filter(r=>r.generated===0&&r.state==='accepted').length,generated:0,delivered:0,pending:0,rejected:{},outcomes:{},modelP50Ms:latencies.length?latencies[Math.floor((latencies.length-1)*.5)]:null,modelP95Ms:latencies.length?latencies[Math.ceil(latencies.length*.95)-1]:null};
    for(const row of rows){summary.outcomes[row.state]=(summary.outcomes[row.state]||0)+1;summary.generated+=row.generated||0;summary.delivered+=row.delivered;summary.pending+=row.pending;for(const [reason,n] of Object.entries(row.rejected))summary.rejected[reason]=(summary.rejected[reason]||0)+n;}
    return {version:1,since:this.since,exportedAt:this.now(),limit:LIMIT,retention:'current broadcast; retained after stop until the next start or app exit',scope:'live reactions only; counts and durations, no conversation or media content',summary,skips:{...this.skips},requests:rows};
  }
}

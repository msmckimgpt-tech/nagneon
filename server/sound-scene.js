import {z} from 'zod';
import {randomUUID} from 'node:crypto';
export const SoundResult=z.object({durationSeconds:z.number().min(.1).max(9),volumeDb:z.number().min(-180).max(5),balance:z.number().min(-1).max(1),silent:z.boolean(),classes:z.array(z.object({id:z.string().max(40),label:z.string().max(100),score:z.number().min(0).max(1),peak:z.number().min(0).max(1),offsetSeconds:z.number().min(0).max(9)})).max(8),systemSpeech:z.string().max(1000),language:z.string().max(20),source:z.literal('system-output'),caveat:z.string().max(200)});
export class SoundScene {
  constructor(studio){this.studio=studio;this.active=null;this.events=[];this.seen=new Set();this.busy=false;}
  start(id){if(!this.studio.running||this.studio.settings.mode!=='live')throw Error('시스템 소리는 실제 AI 방송에서 인식합니다.');this.stop();this.active={id,sessionId:this.studio.sessionId,connectedAt:this.studio.now(),controller:new AbortController()};return this.active;}
  stop(id){if(id&&id!==this.active?.id)return;this.active?.controller.abort();this.active=null;this.events=[];this.seen.clear();this.busy=false;this.ticket=null;}
  begin({id,segmentId,startedAt,endedAt}){
    const s=this.studio,now=s.now();if(!this.active||this.active.id!==id||!s.running||s.sessionId!==this.active.sessionId)throw Error('만료된 소리 연결입니다.');
    if(this.busy)throw Error('이전 소리를 처리 중입니다.');if(this.seen.has(segmentId))throw Error('이미 전달한 소리 구간입니다.');
    if(!Number.isFinite(startedAt)||!Number.isFinite(endedAt)||startedAt<this.active.connectedAt-1500||endedAt>now+2000||now-endedAt>45000||endedAt-startedAt<100||endedAt-startedAt>9000)throw Error('소리 구간의 시각을 확인하세요.');
    this.seen.add(segmentId);while(this.seen.size>40)this.seen.delete(this.seen.values().next().value);this.busy=true;
    const witnesses=s.presentWitnesses().filter(p=>s.audience.data.members[p]?.joinedAt<=startedAt);
    this.ticket={id,segmentId,startedAt,endedAt,sessionId:s.sessionId,witnesses};return this.ticket;
  }
  finish(ticket,result){
    if(this.ticket!==ticket||this.active?.id!==ticket.id||this.studio.sessionId!==ticket.sessionId||!this.studio.running)return null;
    const value=SoundResult.parse(result);this.release(ticket);const event={...value,id:randomUUID(),startedAt:ticket.startedAt,endedAt:ticket.endedAt,witnesses:ticket.witnesses};
    this.events=[...this.events.filter(e=>this.studio.now()-e.endedAt<45000),event].slice(-8);return event;
  }
  release(ticket){if(this.ticket===ticket){this.busy=false;this.ticket=null;}}
  context(viewerId){return structuredClone(this.events.filter(e=>this.studio.now()-e.endedAt<30000&&e.witnesses.includes(viewerId)&&!e.silent).slice(-4).map(({witnesses,...e})=>e));}
  snapshot(){return {connected:!!this.active,busy:this.busy,source:'Windows 시스템 출력 전체',last:this.active?this.events.at(-1)||null:null};}
}

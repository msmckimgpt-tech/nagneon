import {z} from 'zod';
const actor=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/).refine(v=>!['__proto__','constructor','prototype'].includes(v));
const time=z.number().finite().nonnegative().max(8.64e15),hash=z.string().regex(/^[a-f0-9]{64}$/);
export const ActivityRead=z.object({viewerId:actor,revision:hash,at:time}).strict();
export const ActivityReads=z.array(ActivityRead).max(150).refine(rows=>new Set(rows.map(r=>r.viewerId)).size===rows.length);
export const CommunityActivityData=z.object({
  clock:time,nextAt:time,
  attempts:z.array(z.object({kind:z.enum(['clip','gallery','review','social-birth','social-daily','social-mention','social-read']),id:z.string().min(1).max(100),viewerId:actor,revision:hash,at:time}).strict()).max(300),
  reviews:z.array(z.object({sessionId:z.string().uuid(),viewerId:actor,at:time}).strict()).max(1000)
}).strict();
export const emptyCommunityActivity=()=>({clock:0,nextAt:0,attempts:[],reviews:[]});
export function recordActivityRead(target,read){
  target.activityReads=(target.activityReads||[]).filter(r=>r.viewerId!==read.viewerId);
  target.activityReads.push(ActivityRead.parse(read));
  target.activityReads=target.activityReads.slice(-150);
}

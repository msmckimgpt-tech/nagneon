import {randomUUID} from 'node:crypto';
import {z} from 'zod';
import {ActivityReads,recordActivityRead} from './community-activity-state.js';

const categories=['자유','후기','질문','공지'];
const actor=z.string().regex(/^[a-zA-Z0-9_-]{1,80}$/);
export const GalleryPost=z.object({activityReads:ActivityReads.optional(),id:z.string().min(1).max(100),name:z.string(),text:z.string(),time:z.number().nonnegative(),kind:z.string(),personaId:actor.optional(),title:z.string().max(100).optional(),category:z.enum(categories).optional(),votes:z.array(actor).max(41).optional(),comments:z.array(z.object({id:z.string().uuid(),name:z.string().max(100),personaId:actor,text:z.string().max(1000),time:z.number().nonnegative(),parentId:z.string().uuid().nullable(),kind:z.enum(['streamer','ai']),deleted:z.boolean().optional()})).max(150).optional()}).passthrough().superRefine((p,ctx)=>{
  const comments=p.comments||[],ids=new Set(comments.map(c=>c.id));
  if(ids.size!==comments.length||new Set(p.votes||[]).size!==(p.votes||[]).length)ctx.addIssue({code:'custom',message:'게시판 기록에 중복 ID가 있습니다.'});
  for(const c of comments)if(c.parentId&&!comments.some(parent=>parent.id===c.parentId&&!parent.parentId))ctx.addIssue({code:'custom',message:'게시판 답글 연결이 올바르지 않습니다.'});
});
export const galleryPost=p=>{const {activityReads,...publicPost}=structuredClone(p);return {...publicPost,title:p.title||p.text.split('\n')[0].slice(0,70)||'방송 이야기',category:p.category||(p.kind==='ai'?'후기':'자유'),comments:structuredClone(p.comments||[]),votes:[...(p.votes||[])]};};

export class Community {
  constructor(studio){this.studio=studio;}
  list(){return this.studio.audience.data.posts.map(galleryPost).reverse();}
  get(id){const post=this.studio.audience.data.posts.find(p=>p.id===id);if(!post)throw Error('게시글을 찾을 수 없습니다.');return galleryPost(post);}
  change(fn){const a=this.studio.audience,next=structuredClone(a.data);const value=fn(next.posts);next.posts=next.posts.map(p=>GalleryPost.parse(p));a.save(next);a.data=next;this.studio.publish();return value;}
  post({title,text,category='자유'}){
    const body=z.object({title:z.string().trim().min(1).max(100),text:z.string().trim().min(1).max(1000),category:z.enum(categories)}).parse({title,text,category});
    return this.change(posts=>{if(posts.length>=200)throw Error('게시판 글은 200개까지 보관합니다. 이전 글을 정리해주세요.');const p={...body,id:randomUUID(),personaId:'streamer',name:this.studio.settings.streamer,time:this.studio.now(),kind:'streamer',comments:[],votes:[]};posts.push(p);return p;});
  }
  remove(id){this.change(posts=>{const index=posts.findIndex(p=>p.id===id);if(index<0)throw Error('게시글을 찾을 수 없습니다.');posts.splice(index,1);});}
  recommend(id,recommended){return this.change(posts=>{const p=posts.find(p=>p.id===id);if(!p)throw Error('게시글을 찾을 수 없습니다.');p.votes=(p.votes||[]).filter(v=>v!=='streamer');if(recommended)p.votes.push('streamer');return galleryPost(p);});}
  comment(id,{text,parentId=null}){return this.addComments(id,[{text,name:this.studio.settings.streamer,personaId:'streamer',kind:'streamer',parentId}]);}
  addComments(id,items,expected,votes=[],activityRead){return this.change(posts=>{
    const p=posts.find(p=>p.id===id);if(!p)throw Error('게시글을 찾을 수 없습니다.');if(expected&&JSON.stringify(galleryPost(p))!==expected)throw Error('읽는 동안 게시글이 바뀌었습니다. 새 내용을 확인해주세요.');
    p.comments||=[];if(p.comments.length+items.length>150)throw Error('게시글 댓글은 150개까지 보관합니다.');
    const created=items.map(i=>{if(!i.text.trim()||i.text.length>1000)throw Error('댓글은 1~1,000자로 작성하세요.');if(i.parentId&&!p.comments.some(c=>c.id===i.parentId&&!c.parentId&&!c.deleted))throw Error('답글 대상 댓글을 확인해주세요.');return {...i,id:randomUUID(),text:i.text.trim(),time:this.studio.now()};});p.comments.push(...created);
    for(const vote of votes){p.votes=(p.votes||[]).filter(id=>id!==vote.personaId);if(vote.recommended)p.votes.push(vote.personaId);}if(activityRead)recordActivityRead(p,activityRead);return created;
  });}
  removeComment(id,commentId){this.change(posts=>{const p=posts.find(p=>p.id===id),c=p?.comments?.find(c=>c.id===commentId);if(!c)throw Error('댓글을 찾을 수 없습니다.');c.deleted=true;c.text='삭제된 댓글입니다.';});}
  async react(id,parentId=null){
    const s=this.studio;if(s.running||s.busy||s.training.active)throw Error('방송과 관객 응답이 끝난 뒤 게시판을 읽을 수 있습니다.');if(s.settings.mode!=='live')throw Error('실제 AI 모드에서 관객이 게시판을 읽을 수 있습니다.');
    const post=this.get(id),expected=JSON.stringify(post);if(parentId&&!post.comments.some(c=>c.id===parentId&&!c.deleted&&!c.parentId))throw Error('답글 대상 댓글을 확인해주세요.');
    const people=s.settings.personas.filter(p=>p.enabled&&!p.system&&s.audience.data.members[p.id]?.sessions>0).map(p=>({p,order:s.random()})).sort((a,b)=>a.order-b.order).slice(0,3).map(x=>x.p);if(!people.length)throw Error('방송에서 만난 관객이 먼저 필요합니다.');
    s.reserveCall();s.busy=true;s.controller=new AbortController();s.publish();const epoch=s.epoch;
    try{
      const {observation,usage}=await s.provider.react({settings:{...s.settings,personas:people,chatPace:3,webSearch:false},history:[],previous:null,speech:'',offStream:true,special:{kind:'gallery-comment',post,replyTo:post.comments.find(c=>c.id===parentId)||null,instruction:'이 PC의 가상 갤러리 게시글과 댓글을 방금 읽었다. 취향에 맞거나 할 말이 있는 관객만 짧게 댓글을 쓴다. 방송에 직접 있었다거나 영상을 봤다고 지어내지 않는다. 사실을 분석하는 보고서 대신 갤러리의 편한 문어체로 쓰되 사람마다 어투가 다르다. 화면 없는 게시판이므로 현재 라이브 장면이나 실제 후원은 없다. 댓글을 추천 부탁으로 마무리하지 않는다. 각 관객은 글의 내용과 자신의 취향에 따라 추천 여부를 communityVotes에 personaId와 recommended로 따로 표시한다. 댓글을 안 써도 추천하거나 추천하지 않을 수 있다. 무조건 추천하거나 후원으로 표현하지 않는다.'}},s.controller.signal);
      if(epoch!==s.epoch)throw Error('게시판 응답이 취소되었습니다.');s.tokens+=Number(usage?.total_tokens)||0;
      const current=id=>people.some(p=>p.id===id)&&s.settings.personas.some(p=>p.id===id&&p.enabled);
      const used=new Set(),items=observation.messages.flatMap(m=>{const p=people.find(p=>p.id===m.personaId);if(!p||!current(p.id)||used.has(p.id)||post.comments.some(c=>!c.deleted&&c.personaId===p.id&&c.text.trim()===m.text.trim()&&c.parentId===parentId)||m.spoiler&&s.settings.spoilerGuard||s.settings.blockedWords.some(w=>m.text.includes(w)))return [];used.add(p.id);return [{text:m.text,name:p.name,personaId:p.id,parentId,kind:'ai'}];});
      const votes=(observation.communityVotes||[]).filter(v=>current(v.personaId));
      return this.addComments(id,items,expected,votes);
    }finally{if(epoch===s.epoch){s.busy=false;s.publish();}}
  }
}

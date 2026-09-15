import {z} from 'zod';

export const tutorialSteps=['audience','invite','studio','start','greet','hide','show','overlay','meet','stop','finish'];
export const TutorialData=z.object({
  version:z.literal(1),status:z.enum(['new','active','paused','completed','skipped']),
  step:z.enum(tutorialSteps),skipped:z.array(z.enum(tutorialSteps)).default([]),
  originalMode:z.enum(['live','rehearsal']).nullable().default(null),
  originalDisplay:z.boolean().nullable().default(null)
});
export const initialTutorial=(existing=false)=>TutorialData.parse({version:1,status:existing?'skipped':'new',step:'audience'});

export class Tutorial {
  constructor(studio,store){this.studio=studio;this.store=store;this.sessionId=null;this.overlayAdjusted=false;this.overlayClosed=false;}
  snapshot(){
    const entries=Object.entries(this.studio.world.data.autonomy.receipts).filter(([,r])=>r.firstTutorial);
    const last=entries.at(-1);
    return {...this.store.data,arrival:last?{id:last[0],status:last[1].status,personaId:last[1].personaId,error:last[1].error}:null,overlayAdjusted:this.overlayAdjusted,overlayClosed:this.overlayClosed};
  }
  save(patch){const next=TutorialData.parse({...this.store.data,...patch});this.store.save(next);this.store.data=next;this.studio.publish();return this.snapshot();}
  begin(){
    const s=this.studio;if(s.running||s.busy)throw Error('방송을 종료한 뒤 튜토리얼을 시작하세요.');
    this.overlayAdjusted=false;this.overlayClosed=false;
    const resume=['active','paused'].includes(this.store.data.status);
    return this.save({status:'active',...(resume?{}:{step:'audience',skipped:[],originalMode:s.settings.mode,originalDisplay:s.settings.showStreamerMessages!==false})});
  }
  start(){
    const s=this.studio;if(this.store.data.status!=='active')throw Error('튜토리얼을 먼저 시작하세요.');
    if(s.running){if(this.sessionId!==s.sessionId)throw Error('다른 방송이 진행 중입니다.');return;}
    // Remember ownership only for the rehearsal started by this tutorial.
    if(this.store.data.originalMode===null)this.save({originalMode:s.settings.mode,originalDisplay:s.settings.showStreamerMessages!==false});
    s.configure({...s.settings,mode:'rehearsal',showStreamerMessages:true});s.start();this.sessionId=s.sessionId;
  }
  leave(status){
    const s=this.studio;
    if(s.running&&this.sessionId===s.sessionId&&s.settings.mode==='rehearsal')s.stop();
    if(s.running||s.busy)throw Error('현재 방송을 종료한 뒤 안내를 마쳐주세요.');
    const d=this.store.data;
    if(d.originalMode!==null)s.configure({...s.settings,mode:d.originalMode,showStreamerMessages:d.originalDisplay??true});
    this.sessionId=null;return this.save({status});
  }
  advance(step,skip=false){
    if(this.store.data.status!=='active'||step!==this.store.data.step)return this.snapshot();
    if(step==='finish')return this.leave('completed');
    return this.save({step:tutorialSteps[tutorialSteps.indexOf(step)+1],skipped:skip?[...new Set([...this.store.data.skipped,step])]:this.store.data.skipped});
  }
  invite(requestId){
    const s=this.studio;
    // Only this route can select the background first-arrival exception.
    if(!['active','paused','completed','skipped'].includes(this.store.data.status))throw Error('첫 실행 설정을 먼저 마쳐주세요.');
    const prior=s.world.data.autonomy.receipts[requestId];
    if(prior){if(!prior.firstTutorial)throw Error('다른 만남의 요청입니다.');return this.snapshot();}
    const operation=s.autonomy.arrive(requestId,{firstTutorial:true});
    // Validation and hold happen synchronously before the provider awaits. A
    // rejected preflight has no receipt; propagate it instead of a false 202.
    if(!s.world.data.autonomy.receipts[requestId])return operation;
    this.operation=operation.catch(error=>{s.lastError=error.message;s.publish();});
    return this.snapshot();
  }
}

export function tutorialRoutes(app,tutorial){
  app.post('/api/tutorial',(req,res)=>{
    const input=z.object({action:z.enum(['begin','pause','skip','advance']),step:z.enum(tutorialSteps).optional(),skip:z.boolean().optional()}).strict().parse(req.body);
    res.json(input.action==='begin'?tutorial.begin():input.action==='pause'?tutorial.leave('paused'):input.action==='skip'?tutorial.leave('skipped'):tutorial.advance(input.step,input.skip));
  });
  app.post('/api/tutorial/rehearsal',(_req,res)=>{tutorial.start();res.json(tutorial.snapshot());});
  app.post('/api/tutorial/arrival',async(req,res)=>{const {requestId}=z.object({requestId:z.string().uuid()}).strict().parse(req.body);res.status(202).json(await tutorial.invite(requestId));});
  app.post('/api/tutorial/overlay',(req,res)=>{
    const {action}=z.object({action:z.enum(['adjust','close'])}).strict().parse(req.body);
    if(tutorial.store.data.status==='active'&&tutorial.store.data.step==='overlay'){
      if(action==='adjust')tutorial.overlayAdjusted=true;
      if(action==='close'&&tutorial.overlayAdjusted)tutorial.overlayClosed=true;
      tutorial.studio.publish();
    }
    res.json(tutorial.snapshot());
  });
}

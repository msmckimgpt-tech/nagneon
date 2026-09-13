import {Settings} from './schema.js';
import {defaults} from '../shared/defaults.js';

// A deliberately synthetic, one-call readiness probe. No user settings, chat,
// images, microphone input, private character memories or points are included.
export class ConnectionProbe{
  constructor(provider,publish=()=>{}){this.provider=provider;this.publish=publish;this.value={status:'untested'};this.controller=null;}
  status(){return {...this.value};}
  async run(){
    if(this.controller)throw new Error('이미 응답을 확인하고 있습니다.');
    if(!this.provider.status().configured)throw new Error('ChatGPT 계정을 먼저 연결해주세요.');
    this.controller=new AbortController();const controller=this.controller;const started=Date.now();
    this.value={status:'checking',startedAt:started};this.publish();
    const settings=Settings.parse({...structuredClone(defaults),title:'연결 확인',streamer:'테스트',category:'just-chatting',mode:'live',chatPace:1,personas:[{...defaults.personas[0],id:'probe',name:'연결 도우미'}],managerId:'probe'});
    try{
      const result=await this.provider.react({settings,history:[],speech:'연결 확인입니다. 짧은 한국어 인사 한 문장으로 응답해주세요.',previous:null,knowledge:null,audience:{eligible:['probe'],members:[{id:'probe',presence:'active'}],lore:[],offStreamPosts:[]},adviceRequested:false},controller.signal);
      if(controller.signal.aborted)throw new Error('취소됨');
      const reply=result.observation.messages.find(m=>m.personaId==='probe')?.text;
      if(!reply)throw new Error('연결 확인용 응답을 받지 못했습니다. 다시 시도해주세요.');
      this.value={status:'ready',checkedAt:Date.now(),latencyMs:Date.now()-started,model:this.provider.model,effort:this.provider.effort,reply:reply.slice(0,240),tokens:Number(result.usage?.total_tokens)||0};
    }catch(error){this.value=controller.signal.aborted?{status:'cancelled'}:{status:'failed',checkedAt:Date.now(),reason:['usage','model','auth','network'].includes(error.code)?error.code:'unknown',message:error.message};}
    finally{if(this.controller===controller)this.controller=null;this.publish();}
    return this.status();
  }
  cancel(){this.controller?.abort();return {ok:true};}
}

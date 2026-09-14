import {z} from 'zod';

export const ProviderSelection=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('codex')}).strict(),z.object({kind:z.literal('openai')}).strict(),
  z.object({kind:z.literal('ollama'),model:z.string().trim().min(1).max(200),base:z.string().max(200).default('http://127.0.0.1:11434'),contextSize:z.number().int().min(4096).max(131072).default(65536)}).strict()
]);

// Stable facade: Studio and desktop account helpers keep the same reference.
// Audio overrides belong to this facade, not the replaceable inference backend.
export class ProviderChoice {
  constructor({factories,initial={kind:'codex'},save=()=>{}}){
    this.factories=factories;this.save=save;this.config=ProviderSelection.parse(initial);this.backends={};this.active=this.create(this.config);this.changing=false;
    this.proxy=new Proxy(this,{get:(target,key)=>{
      if(key in target){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}
      const backend=['bin','env'].includes(key)?this.codex():this.active;const value=backend[key];return typeof value==='function'?value.bind(backend):value;
    },set:(target,key,value)=>{if(key==='key'){target.active.key=value;return true;}Reflect.set(target,key,value);return true;}});
  }
  codex(){return this.backends.codex??=this.factories.codex();}
  create(config){return config.kind==='ollama'?this.factories.ollama(config):config.kind==='codex'?this.codex():(this.backends.openai??=this.factories.openai());}
  snapshot(){return {config:{...this.config},changing:this.changing};}
  status(){return {...this.active.status(),kind:this.config.kind};}
  async check(...args){return this.active.check?.(...args);}
  async react(...args){if(this.changing)throw Error('AI 제공처 변경을 마친 뒤 다시 시도해주세요.');return this.active.react(...args);}
  async transcribe(...args){return this.active.transcribe(...args);}
  async select(value,{signal,canApply=()=>true}={}){
    if(this.changing)throw Error('이미 AI 제공처를 변경하고 있습니다.');const config=ProviderSelection.parse(value);this.changing=true;
    try{
      signal?.throwIfAborted();const candidate=this.create(config);await candidate.check?.(signal);signal?.throwIfAborted();
      if(!canApply())throw Error('앱 상태가 바뀌어 제공처 변경을 취소했습니다.');
      if(config.kind==='ollama'&&!candidate.status().configured)throw Error(candidate.status().authMessage||'로컬 모델을 확인하지 못했습니다.');
      this.save(config);this.active=candidate;this.config=config;this.changing=false;return this.snapshot();
    }finally{this.changing=false;}
  }
}

import {z} from 'zod';
const model=z.string().trim().min(1).max(200).regex(/^[a-zA-Z0-9][a-zA-Z0-9._:/-]*$/);
const effort=z.enum(['none','minimal','low','medium','high','xhigh','max']).optional();

export const ProviderSelection=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('codex'),model:model.optional(),effort}).strict(),z.object({kind:z.literal('openai'),model:model.optional(),effort}).strict(),
  z.object({kind:z.literal('claude-cli'),model,bin:z.string().max(500).optional()}).strict(),z.object({kind:z.literal('gemini-cli'),model,bin:z.string().max(500).optional()}).strict(),
  z.object({kind:z.literal('claude'),model}).strict(),z.object({kind:z.literal('gemini'),model}).strict(),
  z.object({kind:z.literal('ollama'),model:z.string().trim().min(1).max(200),base:z.string().max(200).default('http://127.0.0.1:11434'),contextSize:z.number().int().min(4096).max(131072).default(65536)}).strict()
]);

// Stable facade: Studio and desktop account helpers keep the same reference.
// Audio overrides belong to this facade, not the replaceable inference backend.
export class ProviderChoice {
  constructor({factories,initial={kind:'codex'},save=()=>{},preview=true,baseline={kind:'codex'}}){
    this.factories=factories;this.save=save;this.config=ProviderSelection.parse(initial);this.backends={};this.preview=preview;this.baseline=baseline;this.baselineBackend=this.create(baseline);this.selected=preview?this.create(this.config):null;this.changing=false;
    this.proxy=new Proxy(this,{get:(target,key)=>{
      if(key in target){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}
      const backend=['bin','env'].includes(key)?this.codex():this.active;const value=backend[key];return typeof value==='function'?value.bind(backend):value;
    },set:(target,key,value)=>{if(key==='key'){target.active.key=value;return true;}Reflect.set(target,key,value);return true;}});
  }
  get active(){return this.preview?(this.selected??=this.create(this.config)):this.baselineBackend;}
  setPreview(enabled){this.preview=enabled;}
  codex(){return this.backends.codex??=this.factories.codex();}
  create(config){
    if(config.kind==='codex'&&!config.model&&!config.effort)return this.codex();
    const key=JSON.stringify(config);
    return this.backends[key]??=this.factories[config.kind](config);
  }
  snapshot(){return {config:{...(this.preview?this.config:this.baseline)},changing:this.changing};}
  status(){return {...this.active.status(),kind:(this.preview?this.config:this.baseline).kind};}
  async check(...args){return this.active.check?.(...args);}
  async react(...args){if(this.changing)throw Error('AI 제공처 변경을 마친 뒤 다시 시도해주세요.');return this.active.react(...args);}
  async transcribe(...args){return this.active.transcribe(...args);}
  async select(value,{signal,canApply=()=>true}={}){
    if(!this.preview)throw Error('디버그 모드와 신규 기능 사용해보기를 모두 켜주세요.');
    if(this.changing)throw Error('이미 AI 제공처를 변경하고 있습니다.');const config=ProviderSelection.parse(value);this.changing=true;
    try{
      signal?.throwIfAborted();const candidate=this.create(config);await candidate.check?.(signal);signal?.throwIfAborted();
      if(!canApply())throw Error('앱 상태가 바뀌어 제공처 변경을 취소했습니다.');
      if(config.kind==='ollama'&&!candidate.status().configured)throw Error(candidate.status().authMessage||'로컬 모델을 확인하지 못했습니다.');
      this.save(config);this.selected=candidate;this.config=config;this.changing=false;return this.snapshot();
    }finally{this.changing=false;}
  }
}

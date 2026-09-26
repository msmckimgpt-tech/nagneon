import {z} from 'zod';
import {runAiAttempt} from './ai-control.js';
import audienceModels from '../shared/audience-models.json' with {type:'json'};
import {ProviderRouter,RoutingSelection} from './provider-routing.js';

const hostedFields={model:z.enum(audienceModels.models.map(m=>m.id)).optional(),effort:z.enum(Object.keys(audienceModels.effortLabels)).optional()};

export const SingleProviderSelection=z.discriminatedUnion('kind',[
  z.object({kind:z.literal('antigravity'),model:z.string().regex(/^gemini-[a-zA-Z0-9._-]+$/).max(200).optional(),effort:z.enum(['low','medium','high','max']).optional()}).strict(),
  z.object({kind:z.literal('codex'),...hostedFields}).strict(),z.object({kind:z.literal('openai'),...hostedFields}).strict(),
  z.object({kind:z.literal('ollama'),model:z.string().trim().min(1).max(200),base:z.string().max(200).default('http://127.0.0.1:11434'),contextSize:z.number().int().min(4096).max(131072).default(65536)}).strict()
]).refine(config=>['ollama','antigravity'].includes(config.kind)||!config.effort||(config.model?audienceModels.models.find(m=>m.id===config.model).efforts.includes(config.effort):['low','medium','high','xhigh'].includes(config.effort)),{message:'선택한 모델에서 지원하는 추론 수준을 선택해주세요.'});
export const ProviderSelection=z.union([SingleProviderSelection,RoutingSelection]);

export const hostedModelEnv=config=>({...config?.model?{OPENAI_MODEL:config.model}:{},...config?.effort?{OPENAI_REASONING_EFFORT:config.effort}:{}});

// Stable facade: Studio and desktop account helpers keep the same reference.
// Audio overrides belong to this facade, not the replaceable inference backend.
export class ProviderChoice {
  constructor({factories,initial={kind:'codex'},save=()=>{}}){
    this.factories=factories;this.save=save;this.config=ProviderSelection.parse(initial);this.backends={};this.credentials=new Map();this.active=this.create(this.config);this.changing=false;
    this.proxy=new Proxy(this,{get:(target,key)=>{
      if(key in target){const value=Reflect.get(target,key);return typeof value==='function'?value.bind(target):value;}
      const backend=['bin','env'].includes(key)?this.codex():this.active;const value=backend[key];return typeof value==='function'?value.bind(backend):value;
    },set:(target,key,value)=>{if(key==='key'){if(target.config.kind==='routing'){target.setConnectionKey(target.active.primary.id,value);return true;}target.active.key=value;if(target.backends[target.config.kind])target.backends[target.config.kind].key=value;return true;}Reflect.set(target,key,value);return true;}});
  }
  codex(){return this.backends.codex??=this.factories.codex();}
  create(config){
    if(config.kind==='routing')return new ProviderRouter(config,{onFallback:()=>this.onFallback?.(),create:c=>{
      const factory=c.provider.kind==='openai'?this.factories.configuredApi:this.factories[c.provider.kind];
      if(!factory)throw Error('지원하지 않는 연결 방식입니다.');
      const backend=factory(c.provider);
      if(c.provider.kind==='openai')backend.key=this.credentials.get(this.credentialId(c))||'';
      return backend;
    }});
    if(config.kind==='antigravity')return this.factories.antigravity(config);
    if(config.kind==='ollama')return this.factories.ollama(config);
    const base=config.kind==='codex'?this.codex():(this.backends.openai??=this.factories.openai());
    if(!config.model&&!config.effort)return base;
    const candidate=this.factories[config.kind](config);
    candidate.key=base.key; // Keep an in-memory API key across model changes; never persist it.
    return candidate;
  }
  credentialId(c){return JSON.stringify([c.id,c.provider.kind,c.provider.base]);}
  setConnectionKey(id,value){
    if(this.config.kind!=='routing')throw Error('역할별 연결 설정을 먼저 적용하세요.');
    const c=this.config.connections.find(c=>c.id===id);if(c?.provider.kind!=='openai')throw Error('API 연결을 선택하세요.');
    this.active.setKey(id,value);this.credentials.set(this.credentialId(c),value);
  }
  snapshot(){return {config:this.config.kind==='routing'?{...this.active.primary.provider}:structuredClone(this.config),routing:this.config.kind==='routing'?this.active.snapshot():null,changing:this.changing};}
  status(){return {...this.active.status(),kind:this.config.kind==='routing'?this.active.primary.provider.kind:this.config.kind};}
  async check(...args){return this.active.check?.(...args);}
  get managesAiAttempts(){return true;}
  get transcriptionModel(){return this.active.transcriptionModel;}
  get transcriptionConnection(){return this.active.transcriptionConnection || '';}
  async react(args,signal){if(this.changing)throw Error('AI 제공처 변경을 마친 뒤 다시 시도해주세요.');return this.active.managesAiAttempts?this.active.react(args,signal):runAiAttempt(args,this.active,signal,(a,s)=>this.active.react(a,s));}
  async transcribe(...args){return this.active.transcribe(...args);}
  async select(value,{signal,canApply=()=>true}={}){
    if(this.changing)throw Error('이미 AI 제공처를 변경하고 있습니다.');const config=ProviderSelection.parse(value);this.changing=true;
    try{
      signal?.throwIfAborted();const candidate=this.create(config);await candidate.check?.(signal);signal?.throwIfAborted();
      if(!canApply())throw Error('앱 상태가 바뀌어 제공처 변경을 취소했습니다.');
      if(config.kind==='ollama'&&!candidate.status().configured)throw Error(candidate.status().authMessage||'로컬 모델을 확인하지 못했습니다.');
      this.save(config);this.active=candidate;this.config=config;
      const valid=new Set(config.kind==='routing'?config.connections.map(c=>this.credentialId(c)):[]);
      for(const key of this.credentials.keys())if(!valid.has(key))this.credentials.delete(key);
      this.changing=false;return this.snapshot();
    }finally{this.changing=false;}
  }
}

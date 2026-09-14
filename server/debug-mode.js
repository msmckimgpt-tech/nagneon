import {createHash} from 'node:crypto';
import {z} from 'zod';
import {Settings} from './schema.js';
import {OpenAIProvider} from './provider.js';

export const DebugConfig=z.object({enabled:z.boolean(),mode:z.enum(['append','replace']),prompt:z.string().max(60000)}).strict();
export const initialDebug=()=>({enabled:false,mode:'append',prompt:''});

// Only the authenticated settings API supplies this configuration. Message and
// frame input never carries a caller-provided debug configuration.
export function withDebugPrompt(provider,read){
  return new Proxy(provider,{get(target,key,receiver){
    if(key==='react')return (args,...rest)=>target.react({...args,debugPrompt:read()},...rest);
    return Reflect.get(target,key,receiver);
  }});
}

export function debugRoutes(app,studio,store,{idle=()=>true}={}){
  let config=store.data;
  const requireIdle=()=>{if(studio.running||studio.training.active||studio.busy||!idle())throw Error('방송·연습·진행 중인 요청을 마친 뒤 디버그 설정을 변경해주세요.');};
  const read=()=>({...config});
  const revision=()=>createHash('sha256').update(JSON.stringify(studio.settings)).digest('hex');
  app.get('/api/debug',(_req,res)=>{
    if(!config.enabled)return res.json({config:read()});
    const base=new OpenAIProvider({}).payload({settings:studio.settings,history:[],speech:'',adviceRequested:false}).instructions;
    res.json({config:read(),basePrompt:base,settings:structuredClone(studio.settings),revision:revision()});
  });
  app.put('/api/debug',(req,res)=>{requireIdle();const next=DebugConfig.parse(req.body);store.save(next);config=next;studio.publish();res.json({config:read()});});
  app.put('/api/debug/settings',(req,res)=>{
    requireIdle();if(!config.enabled)throw Error('먼저 디버그 모드를 켜주세요.');
    const input=z.object({revision:z.string(),settings:Settings}).strict().parse(req.body);
    if(input.revision!==revision())throw Error('설정이 다른 작업에서 변경되었습니다. 디버그 탭을 다시 열어 최신 값을 불러와주세요.');
    const next=input.settings;
    const identities=settings=>settings.personas.map(p=>p.id).sort().join('\n');
    if(identities(next)!==identities(studio.settings))throw Error('관객 ID 목록은 기억과 연결되어 있습니다. 기존 ID를 유지하고 이름·성향·프롬프트를 수정해주세요.');
    // World commits the full private settings atomically and refreshes the
    // bound Studio references, without bypassing data schema validation.
    studio.world.part('settings',next);studio.publish();res.json({ok:true});
  });
  return {read,summary:()=>({enabled:config.enabled,customPrompt:config.enabled&&(config.mode==='replace'||!!config.prompt.trim())})};
}

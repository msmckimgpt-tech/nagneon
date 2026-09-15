import {Tutorial,TutorialData,initialTutorial,tutorialRoutes} from './tutorial.js';
import {SpeechCapture} from './speech-screen.js';
import {DebugConfig,initialDebug,withDebugPrompt,debugRoutes} from './debug-mode.js';
import express from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAIProvider } from './provider.js';
import {ProviderChoice,ProviderSelection,hostedModelEnv} from './provider-choice.js';
import {OllamaProvider} from './ollama-provider.js';
import { CodexProvider } from './codex-provider.js';
import { Knowledge } from './knowledge.js';
import {LocalSound} from './local-sound.js';
import {soundRoutes} from './sound-routes.js';
import { LocalSpeech } from './local-speech.js';
import { Audience } from './audience.js';
import { Economy } from './economy.js';
import { Clips } from './clips.js';
import {ClipPerception} from './clip-perception.js';
import {ClipInspector} from './clip-inspector.js';
import {clipRecordingRoutes} from './clip-recording-routes.js';
import { randomUUID } from 'node:crypto';
import { Studio } from './studio.js';
import { Settings, Frame } from './schema.js';
import { z } from 'zod';
import {defaults} from '../shared/defaults.js';
import {JsonStore} from './storage.js';
import {KnowledgeData,AudienceData,EconomyData,ClipsData,EpisodesData} from './data-schema.js';
import {createLocalAccess,connectPage,connectScript} from './local-access.js';
import {existsSync} from 'node:fs';
import {OnboardingData,initialOnboarding,finishOnboarding} from './onboarding.js';
import {ConnectionProbe} from './connection-probe.js';
import {SeasonsData,emptySeasons} from './seasons-schema.js';
import {ConversationJournal,emptyJournal} from './conversation-journal.js';
import {JournalStore} from './journal-store.js';
import {World,WorldData,migrateWorld} from './world.js';
import {RequestLifetime,ownProviderRequests} from './request-lifetime.js';
import {StateFeed} from './state-stream.js';
import {ObsInput} from './obs-input.js';
import {externalChatRoutes} from './external-chat-session.js';

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function startServer({port=Number(process.env.PORT)||4318,dataDir=resolve(root,'data'),provider,persist=true,localSpeech=true,speechWorker,soundWorker,browserConnect=false,developmentOrigin,runtime={},obsClientFactory,youtubeFactory,chzzkFactory,authFactory,openExternalAuth,providerFactories,providerSwitchAllowed=()=>true}={}){
  const access=createLocalAccess({browserConnect});let expectedHost;
  const stores=[];
  const useStore=(name,schema,initial)=>{
    if(!persist)return {data:initial(),save:()=>{}};
    const store=new JsonStore(resolve(dataDir,name+'.json'),{validate:value=>schema.parse(value),initial,backupCount:3});
    const data=store.load();stores.push(store);return {data,save:value=>store.save(value)};
  };
  let providerChoice;
  if(!provider){
    const selectionStore=useStore('provider-choice',ProviderSelection.nullable(),()=>null);
    const initial=selectionStore.data||(process.env.AI_PROVIDER==='ollama'?{kind:'ollama',model:process.env.OLLAMA_MODEL||'unconfigured',base:process.env.OLLAMA_BASE_URL||'http://127.0.0.1:11434',contextSize:Number(process.env.OLLAMA_CONTEXT_SIZE||65536)}:{kind:process.env.AI_PROVIDER==='openai'?'openai':'codex'});
    providerChoice=new ProviderChoice({initial,save:selectionStore.save,factories:providerFactories||{
      codex:config=>new CodexProvider({...process.env,...hostedModelEnv(config),...(runtime.codexBin?{CODEX_BIN:runtime.codexBin}:{})}),openai:config=>new OpenAIProvider({...process.env,...hostedModelEnv(config)}),
      ollama:config=>new OllamaProvider({OLLAMA_MODEL:config.model,OLLAMA_BASE_URL:config.base,OLLAMA_CONTEXT_SIZE:config.contextSize})
    }});provider=providerChoice.proxy;
  }
  if(provider.check)await provider.check();
  const speech=speechWorker||new LocalSpeech(runtime.speech);const sound=soundWorker||new LocalSound(runtime.sound);
  const clipInspector=new ClipInspector(runtime.clips);
  const providerStatus=provider.status.bind(provider);provider.status=()=>({...providerStatus(),localAudio:speech.ready,localAudioModel:speech.model,localAudioDevice:speech.device,audioFallback:speech.fallback,audioError:speech.error,audioPreparing:!!speech.child&&!speech.ready&&!speech.error});
  if(localSpeech){provider.localSpeech=true;provider.transcribe=(buffer,_mime,signal)=>speech.transcribe(buffer,signal);}
  let debug;
  const requests=new RequestLifetime();provider=ownProviderRequests(withDebugPrompt(provider,()=>debug?.read()),requests);let closing;
  const hasWorld=persist&&['world.json','world.json.bak.1','world.json.bak.2','world.json.bak.3'].some(n=>existsSync(resolve(dataDir,n)));
  const hasPreviousSettings=hasWorld||(persist&&['settings.json','settings.json.bak.1','settings.json.bak.2','settings.json.bak.3'].some(n=>existsSync(resolve(dataDir,n))));
  const settingsStore=hasWorld?null:useStore('settings',Settings,()=>structuredClone(defaults));
  const onboardingStore=useStore('onboarding',OnboardingData,()=>initialOnboarding(hasPreviousSettings));
  const tutorialStore=useStore('tutorial',TutorialData,()=>initialTutorial(onboardingStore.data.status!=='new'));
  const debugStore=useStore('debug',DebugConfig,initialDebug);
  const knowledgeStore=useStore('knowledge',KnowledgeData,()=>({}));
  const audienceStore=hasWorld?null:useStore('audience',AudienceData,()=>new Audience().data);
  const economyStore=hasWorld?null:useStore('economy',EconomyData,()=>new Economy().data);
  const worldStore=useStore('world',WorldData,()=>migrateWorld(settingsStore.data,audienceStore.data,economyStore.data,{fresh:!hasPreviousSettings}));
  const clipsStore=useStore('clips',ClipsData,()=>[]);
  const episodesStore=useStore('episodes',EpisodesData,()=>[]);
  const seasonsStore=useStore('seasons',SeasonsData,emptySeasons);
  const journalStorage=persist?new JournalStore(dataDir):null;
  const journalStore={data:journalStorage?.load()||emptyJournal(),save:value=>journalStorage?.save(value)};if(journalStorage)stores.push(journalStorage);
  // Validate every existing store before writing anything. Then record the
  // first-run identity so a partial completion cannot become a legacy profile.
  if(persist&&!existsSync(resolve(dataDir,'onboarding.json')))onboardingStore.save(onboardingStore.data);
  if(!hasWorld)worldStore.save(worldStore.data);
  const world=new World(worldStore.data,worldStore.save);world.recover();
  const knowledge=new Knowledge(knowledgeStore.data,knowledgeStore.save);
  const audience=new Audience(world.data.audience,value=>world.part('audience',value));
  const journal=new ConversationJournal(journalStore.data,journalStore.save);
  const economy=new Economy(world.data.economy,value=>world.part('economy',value));
  const clips=new Clips({data:clipsStore.data,dir:persist?resolve(dataDir,'clip-media'):undefined,save:clipsStore.save});
  const storageStatus=()=>({warnings:stores.flatMap(s=>s.warnings).slice(-6),recovered:stores.filter(s=>s.recoveredFrom).map(s=>s.recoveredFrom)});
  const studio=new Studio({provider,settings:world.data.settings,persist:value=>world.part('settings',value),world,knowledge,audience,journal,economy,clips,clipPerception:new ClipPerception(runtime),storageStatus});const app=express();
  const tutorial=new Tutorial(studio,tutorialStore);
  const probe=new ConnectionProbe(provider,()=>studio.publish());
  const obsInput=new ObsInput({createClient:obsClientFactory,onChange:()=>studio.publish(),onEnd:sourceId=>studio.endVideo({sessionId:studio.sessionId,sourceId})});
  const stopStudio=studio.stop.bind(studio);studio.stop=()=>{obsInput.disconnect();return stopStudio();};
  const state=studio.state.bind(studio);studio.state=()=>({...state(),onboarding:{...onboardingStore.data},tutorial:tutorial.snapshot(),connectionProbe:probe.status(),...(providerChoice?{providerChoice:providerChoice.snapshot()}:{}),obsInput:obsInput.snapshot()});
  app.disable('x-powered-by');
  app.use((_req,res,next)=>requests.controller.signal.aborted?res.status(503).json({error:'앱을 종료하고 있습니다.'}):next());
  app.use((req,res,next)=>{
    const host=req.headers.host || '';
    if(host!==expectedHost)return res.status(403).json({error:'올바른 로컬 앱 연결만 허용됩니다.'});
    const allowed=new Set([`http://${host}`,...(developmentOrigin?[developmentOrigin]:[])]);
    if(req.headers.origin&&!allowed.has(req.headers.origin))return res.status(403).json({error:'다른 사이트의 요청은 허용하지 않습니다.'});
    if(!['GET','HEAD'].includes(req.method)&&req.headers['x-backseat-client']!=='studio')return res.status(403).json({error:'올바른 앱 요청이 아닙니다.'});
    res.setHeader('X-Content-Type-Options','nosniff');res.setHeader('Cache-Control','no-store');res.setHeader('Referrer-Policy','no-referrer');
    res.setHeader('Content-Security-Policy',"default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob:; connect-src 'self'; frame-ancestors 'none'");next();
  });
  if(browserConnect){
    app.get('/connect',(_req,res)=>res.type('html').send(connectPage));
    app.get('/connect.js',(_req,res)=>res.type('js').send(connectScript));
    app.post('/api/session',express.json({limit:'1kb'}),(req,res)=>access.redeem(req.body?.token,res)?res.json({ok:true}):res.status(401).json({error:'연결 주소가 만료되었거나 올바르지 않습니다.'}));
  }
  app.use((req,res,next)=>access.authenticated(req)?next():res.status(401).json({error:'앱 연결 인증이 필요합니다. Nagneon 창에서 다시 연결하세요.'}));
  app.use(express.json({limit:'3mb'}));
  app.use((req,res,next)=>probe.controller&&!['GET','HEAD'].includes(req.method)&&!['/api/connection/probe/cancel','/api/stop'].includes(req.path)?res.status(409).json({error:'연결 응답 확인을 마친 뒤 다시 시도하세요.'}):next());
  app.use((req,res,next)=>providerChoice?.changing&&!['GET','HEAD'].includes(req.method)&&req.path!=='/api/stop'?res.status(409).json({error:'AI 제공처 변경을 마친 뒤 다시 시도하세요.'}):next());
  app.get('/api/state',(_req,res)=>res.json(studio.state()));
  debug=debugRoutes(app,studio,debugStore,{idle:()=>!requests.pending.size&&!providerChoice?.changing&&!probe.controller&&providerSwitchAllowed()});
  const debugState=studio.state.bind(studio);studio.state=()=>({...debugState(),debug:debug.summary()});
  const external=externalChatRoutes(app,studio,{youtubeFactory,chzzkFactory,authFactory,openExternalAuth});
  const externalState=studio.state.bind(studio);studio.state=()=>({...externalState(),externalChat:external.snapshot()});
  const externalStop=studio.stop.bind(studio);studio.stop=()=>{external.disconnect();return externalStop();};
  app.post('/api/obs/connect',async(req,res)=>{
    const settings=z.object({port:z.number().int().min(1).max(65535),password:z.string().max(1024)}).strict().parse(req.body);
    if(res.destroyed)return;
    const pending=obsInput.connect(settings),client=obsInput.client;
    const cancel=()=>{if(!res.writableEnded&&obsInput.client===client)obsInput.disconnect();};res.on('close',cancel);
    try{const result=await pending;if(!res.destroyed)res.json(result);}finally{res.off('close',cancel);}
  });
  app.post('/api/obs/select',(req,res)=>res.json(obsInput.select(z.object({scene:z.string().min(1).max(240)}).strict().parse(req.body).scene)));
  app.post('/api/obs/frame',async(req,res)=>res.json(await obsInput.frame(z.object({sourceId:z.string().uuid()}).strict().parse(req.body).sourceId)));
  app.post('/api/obs/disconnect',(_req,res)=>{obsInput.disconnect();res.json(obsInput.snapshot());});
  app.use(async(req,_res,next)=>{if(!['GET','HEAD'].includes(req.method))await studio.communityActivity.yield();next();});
  app.get('/api/donations',(_req,res)=>res.json({entries:economy.donationHistory(studio.settings.personas)}));
  app.get('/api/events',(req,res)=>{
    res.setHeader('Content-Type','text/event-stream');res.setHeader('Connection','keep-alive');res.flushHeaders();
    const feed=new StateFeed(res,{patches:req.query.transport==='patches',currentState:()=>studio.state()});
    const send=state=>feed.send(state);send(studio.state());studio.on('state',send);
    const display=value=>feed.display(value);studio.on('chat-display',display);
    const timer=setInterval(()=>feed.heartbeat(),15000);req.on('close',()=>{clearInterval(timer);feed.close();studio.off('state',send);studio.off('chat-display',display);});
  });
  app.put('/api/settings',(req,res)=>{studio.configure(req.body);res.json(studio.state());});
  app.post('/api/audience/arrive',async(req,res)=>{
    const {requestId}=z.object({requestId:z.string().uuid()}).strict().parse(req.body);
    const {source,...receipt}=await studio.autonomy.requestArrival(requestId);res.json(receipt);
  });
  app.put('/api/audience/:id/note',(req,res)=>res.json(studio.autonomy.note(z.string().max(40).parse(req.params.id),z.object({text:z.string().max(2000)}).strict().parse(req.body).text)));
  app.delete('/api/audience/:id',(req,res)=>res.json(studio.autonomy.remove(z.string().max(40).parse(req.params.id))));
  tutorialRoutes(app,tutorial);
  app.post('/api/onboarding',(req,res)=>res.json(finishOnboarding(studio,onboardingStore,req.body)));
  app.post('/api/connection/provider',async(req,res)=>{
    if(!providerChoice)throw Error('이 실행 환경에서는 제공처를 변경할 수 없습니다.');
    const config=ProviderSelection.parse(req.body);
    const idle=()=>!studio.running&&!requests.pending.size&&providerSwitchAllowed();
    if(studio.busy||!idle())throw Error('방송·계정 연결과 모델 요청을 마친 뒤 변경해주세요.');
    const epoch=studio.epoch,controller=new AbortController();
    const cancel=()=>{if(!res.writableEnded)controller.abort();};res.on('close',cancel);studio.busy=true;
    try{
      const pending=providerChoice.select(config,{signal:AbortSignal.any([controller.signal,requests.controller.signal]),canApply:()=>idle()&&studio.epoch===epoch});studio.publish();
      await pending;probe.value={status:'untested'};if(!res.destroyed)res.json(providerChoice.snapshot());
    }finally{res.off('close',cancel);if(studio.epoch===epoch)studio.busy=false;studio.publish();}
  });
  app.post('/api/connection',(req,res)=>{
    if(studio.running)throw new Error('방송을 종료한 뒤 연결 설정을 변경하세요.');
    if(provider.status().kind==='ollama')throw Error('Ollama는 API 키를 사용하지 않습니다.');
    const config=z.object({apiKey:z.string().trim().min(1).max(500)}).parse(req.body);provider.key=config.apiKey;studio.publish();res.json(provider.status());
  });
  app.post('/api/connection/check',async(_req,res)=>{if(provider.check)await provider.check();studio.publish();res.json(provider.status());});
  app.post('/api/connection/probe',async(_req,res)=>{
    if(studio.running||studio.busy)throw new Error('방송을 종료한 뒤 응답을 확인하세요.');
    studio.busy=true;
    try{res.json(await probe.run());}finally{studio.busy=false;studio.publish();}
  });
  app.post('/api/connection/probe/cancel',(_req,res)=>res.json(probe.cancel()));
  app.post('/api/knowledge',(req,res)=>{const {name,text}=z.object({name:z.string().trim().min(1).max(120),text:z.string().trim().min(1).max(3000)}).parse(req.body);knowledge.teach(name,text);studio.publish();res.json(studio.state());});
  app.delete('/api/knowledge',(req,res)=>{const {name}=z.object({name:z.string().min(1).max(120)}).parse(req.body);knowledge.forget(name);studio.publish();res.json(studio.state());});
  app.post('/api/community/lore',(req,res)=>{const {text}=z.object({text:z.string().trim().min(1).max(300)}).parse(req.body);const entry=audience.lore(text);studio.publish();res.json(entry);});
  app.delete('/api/community/lore/:id',(req,res)=>{const id=z.string().regex(/^[a-zA-Z0-9_-]{1,64}$/).parse(req.params.id);if(!audience.forgetLore(id))return res.status(404).json({error:'기억을 찾을 수 없습니다.'});if(studio.liveReaction?.loreIds?.has(id)){studio.liveReaction.superseded=true;studio.liveReaction.controller.abort();}studio.queue=studio.queue.filter(m=>!m.loreIds?.includes(id));studio.publish();res.json({ok:true});});
  app.get('/api/community/posts',(_req,res)=>res.json(studio.community.list()));
  app.post('/api/community/post',(req,res)=>{const body=z.object({text:z.string().trim().min(1).max(1000),title:z.string().trim().min(1).max(100).optional(),category:z.enum(['자유','후기','질문','공지']).default('자유')}).parse(req.body);res.json(studio.community.post({...body,title:body.title||body.text.slice(0,70)}));});
  app.get('/api/community/posts/:id',(req,res)=>res.json(studio.community.get(req.params.id)));
  app.delete('/api/community/posts/:id',(req,res)=>{studio.community.remove(req.params.id);res.json({ok:true});});
  app.post('/api/community/posts/:id/recommend',(req,res)=>res.json(studio.community.recommend(req.params.id,z.object({recommended:z.boolean()}).parse(req.body).recommended)));
  app.post('/api/community/posts/:id/comments',(req,res)=>res.json(studio.community.comment(req.params.id,z.object({text:z.string().trim().min(1).max(1000),parentId:z.string().uuid().nullable().default(null)}).parse(req.body))));
  app.delete('/api/community/posts/:id/comments/:commentId',(req,res)=>{studio.community.removeComment(req.params.id,req.params.commentId);res.json({ok:true});});
  const autonomousCommunityOnly=(_req,res)=>res.status(410).json({error:'관객은 앱이 켜져 있는 동안 스스로 방문하고 댓글과 추천을 결정합니다. 방송 응답이 먼저 진행됩니다.'});
  app.post('/api/community/posts/:id/react',autonomousCommunityOnly);
  app.post('/api/community/reflect',autonomousCommunityOnly);
  app.post('/api/start',(_req,res)=>{if(probe.controller)throw new Error('연결 응답 확인을 마친 뒤 방송을 시작하세요.');studio.start();res.json(studio.state());});
  // Retired story engines: old clients cannot mutate or restart archived stories.
  const retiredStory=(_req,res)=>res.status(410).json({error:'기획 방송 기능은 종료되었습니다. 관객과의 이야기는 방송실 대화로 이어가세요. 예전 기록은 내보내기에 보관되어 있습니다.'});
  app.use(['/api/director','/api/seasons','/api/training'],(req,res,next)=>req.method==='GET'?next():retiredStory(req,res));
  app.get('/api/seasons/:id',(req,res)=>{
    const item=seasonsStore.data.seasons.find(s=>s.id===z.string().uuid().parse(req.params.id));
    if(!item)return res.status(404).json({error:'기록을 찾을 수 없습니다.'});
    res.json(item);
  });
  const viewerClipOnly=(_req,res)=>res.status(409).json({error:'핫클립은 관객이 마음에 든 순간을 직접 골라 만듭니다.'});
  app.post('/api/clips',viewerClipOnly);
  app.get('/api/clips/:id',(req,res)=>res.json(clips.get(z.string().uuid().parse(req.params.id))));
  app.delete('/api/clips/:id',(req,res)=>{clips.remove(z.string().uuid().parse(req.params.id));studio.publish();res.json({ok:true});});
  app.get('/api/clips/:id/media/:kind',(req,res)=>{
    const c=clips.get(z.string().uuid().parse(req.params.id)),kind=req.params.kind;
    const ext=(kind==='video'&&c.video)||(kind==='audio'&&c.audio)?'webm':kind==='voice'&&c.voice?'voice.webm':kind==='thumbnail'?c.thumbnail:null;
    if(!ext)throw new Error('클립 미디어가 없습니다.');
    if(kind==='audio'||kind==='voice')res.type('audio/webm');
    res.sendFile(clips.file(c.id,ext));
  });
  clipRecordingRoutes(app,{studio,clips,inspector:clipInspector});
  app.post('/api/clips/:id/comments',(req,res)=>{const body=z.object({text:z.string().trim().min(1).max(1000),parentId:z.string().uuid().nullable().optional()}).parse(req.body);const comment=clips.comment(z.string().uuid().parse(req.params.id),{...body,name:studio.settings.streamer});studio.publish();res.json(comment);});
  app.delete('/api/clips/:id/comments/:commentId',(req,res)=>{clips.removeComment(z.string().uuid().parse(req.params.id),z.string().uuid().parse(req.params.commentId));studio.publish();res.json({ok:true});});
  app.post('/api/clips/:id/react',autonomousCommunityOnly);
  const requestId=z.string().uuid();
  app.post('/api/special/unlock',(req,res)=>res.json(studio.special.unlock(z.object({kind:z.enum(['profile','relations']),personaId:z.string().max(40),requestId}).parse(req.body))));
  app.post('/api/special/generate',async(req,res)=>res.json(await studio.special.generate(z.discriminatedUnion('kind',[
    z.object({kind:z.literal('thought'),messageId:z.string().uuid(),requestId}),
    z.object({kind:z.literal('interview'),personaId:z.string().max(40),question:z.string().trim().min(1).max(600),requestId}),
    z.object({kind:z.literal('contract'),quoteId:z.string().uuid(),requestId})
  ]).parse(req.body))));
  app.post('/api/special/quote',(req,res)=>res.json(studio.special.quote(z.object({targets:z.array(z.string().max(40)).min(1).max(8),kind:z.enum(['cheer','debate','roleplay','custom']),text:z.string().trim().min(1).max(600)}).parse(req.body))));
  app.post('/api/special/bid',(req,res)=>{studio.special.ready();const {id,amount}=z.object({id:z.string().uuid(),amount:z.number().int().min(1).max(10000)}).parse(req.body);economy.bid(id,amount);studio.publish();res.json({ok:true});});
  app.post('/api/special/cancel',(req,res)=>{const {id}=z.object({id:z.string().uuid()}).parse(req.body);economy.cancel(id);studio.publish();res.json({ok:true});});
  app.post('/api/stop',(_req,res)=>{if(probe.controller)probe.cancel();else studio.stop();res.json(studio.state());});
  app.post('/api/speech',(req,res)=>res.json(studio.receiveSpeech(z.object({id:z.string().uuid(),sessionId:z.string().uuid(),text:z.string().trim().min(1).max(3000),source:z.enum(['keyboard','microphone']).default('keyboard'),capture:SpeechCapture.optional()}).strict().parse(req.body))));
  app.post('/api/chat/display',(req,res)=>res.json(studio.setChatDisplay(z.object({showStreamerMessages:z.boolean()}).strict().parse(req.body).showStreamerMessages)));
  app.post('/api/react',async(req,res)=>{
    const input=Frame.parse(req.body);
    if(input.obsSourceId){
      const sessionId=studio.sessionId;if(!studio.running||studio.settings.mode!=='live')throw Error('실제 AI 방송을 시작한 뒤 OBS 화면을 전달할 수 있습니다.');
      const frame=await obsInput.frame(input.obsSourceId);
      if(sessionId!==studio.sessionId||!studio.running)throw Error('OBS 화면을 받은 방송이 끝났습니다.');
      input.video={sessionId,sourceId:frame.sourceId,frames:[{image:frame.image,at:frame.at}]};delete input.obsSourceId;
    }
    res.json(await studio.react(input));
  });
  app.post('/api/viewing-end',(req,res)=>res.json(studio.endVideo(z.object({sessionId:z.string().uuid(),sourceId:z.string().uuid()}).parse(req.body))));
  soundRoutes(app,studio,sound);
  app.post('/api/audio/prepare',async(_req,res)=>{
    if(!localSpeech)return res.json({ok:true,local:false});
    const controller=new AbortController();const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
    try{await speech.prepare(controller.signal,studio.settings.speechDevice);if(!controller.signal.aborted)res.json({ok:true,local:true});}
    finally{res.off('close',disconnect);studio.publish();}
  });
  app.post('/api/audio',express.raw({type:['audio/webm','audio/mp4','audio/ogg','audio/wav'],limit:'8mb'}),async(req,res)=>{
    if(!Buffer.isBuffer(req.body)||!req.body.length)throw new Error('음성 데이터가 비어 있습니다.');
    const controller=new AbortController();const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
    try{const result=await studio.transcribe(req.body,req.headers['content-type'].split(';')[0],controller.signal);if(!controller.signal.aborted)res.json(result);}
    catch(error){if(localSpeech&&!speech.ready){if(!controller.signal.aborted)res.status(409).json({error:error.message,needsPreparation:true});}else throw error;}
    finally{res.off('close',disconnect);}
  });
  app.post('/api/moderate',(req,res)=>{const {action,id}=z.object({action:z.enum(['delete','ban','unban','clear']),id:z.string().default('')}).parse(req.body);studio.moderate(action,id);res.json(studio.state());});
  app.get('/api/journal',(req,res)=>res.json(journal.list(z.object({viewerId:z.string().max(80).optional(),query:z.string().max(300).optional(),pinned:z.enum(['true','false']).optional().transform(v=>v==='true'),offset:z.coerce.number().int().min(0).max(4000).default(0),limit:z.coerce.number().int().min(1).max(40).default(30)}).parse(req.query))));
  app.post('/api/journal/:id/pin',(req,res)=>{const id=z.string().uuid().parse(req.params.id);const {pinned}=z.object({pinned:z.boolean()}).parse(req.body);journal.pin(id,pinned);studio.publish();res.json({ok:true});});
  app.delete('/api/journal/:id',(req,res)=>{if(studio.busy)throw new Error('관객 응답이 끝난 뒤 기억을 지울 수 있습니다.');studio.moderate('delete',z.string().uuid().parse(req.params.id));studio.queue=[];studio.publish();res.json({ok:true});});
  app.get('/api/diagnostics/reactions',(req,res)=>{if(req.query.download==='true')res.attachment('nagneon-reaction-diagnostics.json');res.set('Cache-Control','no-store').json(studio.reactions.snapshot(studio.queue));});
  app.get('/api/export',(_req,res)=>{res.attachment(`nagneon-${studio.sessionId || 'session'}.json`).json({exportedAt:new Date().toISOString(),...studio.state(),seasonsArchive:seasonsStore.data,episodesArchive:episodesStore.data,conversationJournal:journal.data});});
  app.use(express.static(resolve(root,'dist')));
  app.get(['/', '/overlay'],(_req,res)=>res.sendFile(resolve(root,'dist/index.html')));
  app.use((error,_req,res,_next)=>res.status(error instanceof z.ZodError?400:409).json({error:error instanceof z.ZodError?'입력 설정을 확인하세요: '+error.issues.map(i=>i.message).join(', '):error.message || '요청 처리 실패'}));
  const server=await new Promise((resolve,reject)=>{const s=app.listen(port,'127.0.0.1',()=>resolve(s));s.on('error',reject);});
  expectedHost=`127.0.0.1:${server.address().port}`;
  // Start the local worker only when the renderer requests audio preparation.
  const health=setInterval(()=>studio.publish(),5000);health.unref();
  return {server,studio,obsInput,url:`http://${expectedHost}`,accessToken:access.token,close:()=>{
    if(closing)return closing;
    clearInterval(health);obsInput.disconnect();
    // Start every cleanup even if another one fails, and keep the event loop
    // alive until all owned requests have left their cleanup/finally blocks.
    const invoke=fn=>{try{return Promise.resolve(fn());}catch(error){return Promise.reject(error);}};
    const tasks=[requests.close(),invoke(()=>tutorial.operation),invoke(()=>probe.cancel()),invoke(()=>studio.close()),invoke(()=>clipInspector.close()),invoke(()=>speech.close()),invoke(()=>studio.communityActivity.yield()),invoke(()=>studio.clipPerception.close()),invoke(()=>sound.close()),invoke(()=>new Promise((done,fail)=>{server.close(error=>error?fail(error):done());server.closeAllConnections();}))];
    closing=Promise.allSettled(tasks).then(results=>{
      const errors=results.filter(result=>result.status==='rejected').map(result=>result.reason);
      if(errors.length)throw new AggregateError(errors,'앱 종료 정리를 완료하지 못했습니다.');
    });
    return closing;
  }};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const service=await startServer({browserConnect:true,developmentOrigin:'http://127.0.0.1:5173'});console.log(`Nagneon 개발용 일회용 연결 주소 (공유하지 마세요):\n${service.url}/connect#${service.accessToken}`);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>service.close().then(()=>process.exit(0)));
}

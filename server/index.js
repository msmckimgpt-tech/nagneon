import express from 'express';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { OpenAIProvider } from './provider.js';
import { CodexProvider } from './codex-provider.js';
import { Knowledge } from './knowledge.js';
import {LocalSound} from './local-sound.js';
import {soundRoutes} from './sound-routes.js';
import { LocalSpeech } from './local-speech.js';
import { Audience } from './audience.js';
import { Economy } from './economy.js';
import { Clips } from './clips.js';
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

const root=resolve(dirname(fileURLToPath(import.meta.url)),'..');
export async function startServer({port=Number(process.env.PORT)||4318,dataDir=resolve(root,'data'),provider,persist=true,localSpeech=true,soundWorker,browserConnect=false,developmentOrigin,runtime={}}={}){
  const access=createLocalAccess({browserConnect});let expectedHost;
  provider ||= process.env.AI_PROVIDER==='openai'?new OpenAIProvider():new CodexProvider({...process.env,...(runtime.codexBin?{CODEX_BIN:runtime.codexBin}:{})});
  if(provider.check)await provider.check();
  const speech=new LocalSpeech(runtime.speech);const sound=soundWorker||new LocalSound(runtime.sound);
  const providerStatus=provider.status.bind(provider);provider.status=()=>({...providerStatus(),localAudio:speech.ready,audioError:speech.error});
  if(localSpeech){provider.localSpeech=true;provider.transcribe=(buffer,_mime,signal)=>speech.transcribe(buffer,signal);}
  const stores=[];
  const useStore=(name,schema,initial)=>{
    if(!persist)return {data:initial(),save:()=>{}};
    const store=new JsonStore(resolve(dataDir,name+'.json'),{validate:value=>schema.parse(value),initial,backupCount:3});
    const data=store.load();stores.push(store);return {data,save:value=>store.save(value)};
  };
  const hasWorld=persist&&['world.json','world.json.bak.1','world.json.bak.2','world.json.bak.3'].some(n=>existsSync(resolve(dataDir,n)));
  const hasPreviousSettings=hasWorld||(persist&&['settings.json','settings.json.bak.1','settings.json.bak.2','settings.json.bak.3'].some(n=>existsSync(resolve(dataDir,n))));
  const settingsStore=hasWorld?null:useStore('settings',Settings,()=>structuredClone(defaults));
  const onboardingStore=useStore('onboarding',OnboardingData,()=>initialOnboarding(hasPreviousSettings));
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
  const studio=new Studio({provider,settings:world.data.settings,persist:value=>world.part('settings',value),world,knowledge,audience,journal,economy,clips,directorData:episodesStore.data,saveDirector:episodesStore.save,seasonsData:seasonsStore.data,saveSeasons:seasonsStore.save,storageStatus});const app=express();
  const probe=new ConnectionProbe(provider,()=>studio.publish());
  const state=studio.state.bind(studio);studio.state=()=>({...state(),onboarding:{...onboardingStore.data},connectionProbe:probe.status()});
  app.disable('x-powered-by');
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
  app.use((req,res,next)=>access.authenticated(req)?next():res.status(401).json({error:'앱 연결 인증이 필요합니다. BACKSEAT 창에서 다시 연결하세요.'}));
  app.use(express.json({limit:'3mb'}));
  app.use((req,res,next)=>req.method==='POST'&&['/api/director/start','/api/director/advance','/api/seasons','/api/seasons/resume','/api/seasons/advance','/api/seasons/propose','/api/seasons/respond'].includes(req.path)?res.status(409).json({error:'새로운 방송 이야기는 일반 채팅에서 자연스럽게 이어집니다. 방송실에서 관객에게 말해주세요.'}):next());
  app.use((req,res,next)=>probe.controller&&!['GET','HEAD'].includes(req.method)&&!['/api/connection/probe/cancel','/api/stop'].includes(req.path)?res.status(409).json({error:'연결 응답 확인을 마친 뒤 다시 시도하세요.'}):next());
  app.get('/api/state',(_req,res)=>res.json(studio.state()));
  app.get('/api/events',(req,res)=>{
    res.setHeader('Content-Type','text/event-stream');res.setHeader('Connection','keep-alive');res.flushHeaders();
    const send=(state)=>res.write(`data: ${JSON.stringify(state)}\n\n`);send(studio.state());studio.on('state',send);
    const display=value=>res.write(`event: chat-display\ndata: ${JSON.stringify(value)}\n\n`);studio.on('chat-display',display);
    const timer=setInterval(()=>res.write(': heartbeat\n\n'),15000);req.on('close',()=>{clearInterval(timer);studio.off('state',send);studio.off('chat-display',display);});
  });
  app.put('/api/settings',(req,res)=>{studio.configure(req.body);res.json(studio.state());});
  app.post('/api/audience/arrive',async(req,res)=>{
    const {requestId}=z.object({requestId:z.string().uuid()}).strict().parse(req.body);
    const {source,...receipt}=await studio.autonomy.requestArrival(requestId);res.json(receipt);
  });
  app.put('/api/audience/:id/note',(req,res)=>res.json(studio.autonomy.note(z.string().max(40).parse(req.params.id),z.object({text:z.string().max(2000)}).strict().parse(req.body).text)));
  app.delete('/api/audience/:id',(req,res)=>res.json(studio.autonomy.remove(z.string().max(40).parse(req.params.id))));
  app.post('/api/onboarding',(req,res)=>res.json(finishOnboarding(studio,onboardingStore,req.body)));
  app.post('/api/connection',(req,res)=>{
    if(studio.running)throw new Error('방송을 종료한 뒤 연결 설정을 변경하세요.');
    const config=z.object({apiKey:z.string().trim().min(1).max(500)}).parse(req.body);provider.key=config.apiKey;studio.publish();res.json(provider.status());
  });
  app.post('/api/connection/check',async(_req,res)=>{if(provider.check)await provider.check();studio.publish();res.json(provider.status());});
  app.post('/api/connection/probe',async(_req,res)=>{
    if(studio.running||studio.training.active||studio.busy)throw new Error('방송과 연습을 종료한 뒤 응답을 확인하세요.');
    studio.busy=true;
    try{res.json(await probe.run());}finally{studio.busy=false;studio.publish();}
  });
  app.post('/api/connection/probe/cancel',(_req,res)=>res.json(probe.cancel()));
  app.post('/api/knowledge',(req,res)=>{const {name,text}=z.object({name:z.string().trim().min(1).max(120),text:z.string().trim().min(1).max(3000)}).parse(req.body);knowledge.teach(name,text);studio.publish();res.json(studio.state());});
  app.delete('/api/knowledge',(req,res)=>{const {name}=z.object({name:z.string().min(1).max(120)}).parse(req.body);knowledge.forget(name);studio.publish();res.json(studio.state());});
  app.post('/api/community/lore',(req,res)=>{const {text,days}=z.object({text:z.string().trim().min(1).max(300),days:z.number().int().min(1).max(90)}).parse(req.body);audience.lore(text,Date.now()+days*86400000);studio.publish();res.json({ok:true});});
  app.post('/api/community/post',(req,res)=>{const {text}=z.object({text:z.string().trim().min(1).max(1000)}).parse(req.body);audience.post({id:randomUUID(),name:studio.settings.streamer,text,time:Date.now(),kind:'streamer'});studio.publish();res.json({ok:true});});
  app.post('/api/community/reflect',async(_req,res)=>res.json(await studio.reflect()));
  app.post('/api/start',(_req,res)=>{if(probe.controller)throw new Error('연결 응답 확인을 마친 뒤 방송을 시작하세요.');studio.start();res.json(studio.state());});
  app.post('/api/training/start',(req,res)=>res.json(studio.startTraining(z.object({id:z.string().max(60)}).parse(req.body).id)));
  app.post('/api/training/action',(req,res)=>{const {action,text}=z.object({action:z.enum(['response','checklist','moderation']),text:z.string().max(600).default('')}).parse(req.body);res.json(studio.trainingAction(action,text));});
  app.post('/api/training/stop',(_req,res)=>res.json(studio.stopTraining()));
  app.post('/api/director/start',(req,res)=>res.json(studio.director.start(z.object({episodeId:z.string().max(60),premise:z.string().trim().max(1200).default(''),targets:z.array(z.string().max(40)).min(1).max(8).optional()}).parse(req.body))));
  app.post('/api/director/advance',async(req,res)=>res.json(await studio.director.advance(z.object({text:z.string().trim().max(1200).default('')}).parse(req.body))));
  app.post('/api/director/finish',(req,res)=>res.json(studio.director.finish(z.object({status:z.enum(['completed','interrupted'])}).parse(req.body).status)));
  const viewerClipOnly=(_req,res)=>res.status(409).json({error:'핫클립은 관객이 마음에 든 순간을 직접 골라 만듭니다.'});
  app.post('/api/director/clip',viewerClipOnly);
  app.post('/api/seasons', (req,res)=>res.json(studio.seasons.create(z.object({templateId:z.string().max(60),title:z.string().max(100).default(''),premise:z.string().max(1200).default('')}).parse(req.body))));
  app.get('/api/seasons/:id',(req,res)=>res.json(studio.seasons.get(z.string().uuid().parse(req.params.id))));
  app.delete('/api/seasons/:id',(req,res)=>{studio.seasons.remove(z.string().uuid().parse(req.params.id));res.json({ok:true});});
  app.post('/api/seasons/resume',(req,res)=>res.json(studio.seasons.resume(z.object({id:z.string().uuid(),targets:z.array(z.string().max(40)).min(1).max(8).optional()}).parse(req.body))));
  app.post('/api/seasons/pause',(_req,res)=>{studio.seasons.pause();res.json({ok:true});});
  app.post('/api/seasons/advance',async(req,res)=>res.json(await studio.seasons.advance(z.object({text:z.string().trim().max(1200).default('')}).parse(req.body))));
  app.post('/api/seasons/choose',(req,res)=>res.json(studio.seasons.choose(z.object({id:z.string().uuid(),choiceId:z.string().max(40).optional()}).parse(req.body))));
  app.post('/api/seasons/clip',viewerClipOnly);
  app.post('/api/seasons/settings',(req,res)=>res.json(studio.seasons.configure(z.object({autoProposals:z.boolean()}).parse(req.body))));
  app.post('/api/seasons/propose',async(_req,res)=>res.json(await studio.seasons.propose()));
  app.post('/api/seasons/respond',(req,res)=>res.json(studio.seasons.respond(z.object({id:z.string().uuid(),action:z.enum(['accept','decline','snooze'])}).parse(req.body))));
  app.post('/api/clips',viewerClipOnly);
  app.get('/api/clips/:id',(req,res)=>res.json(clips.get(z.string().uuid().parse(req.params.id))));
  app.delete('/api/clips/:id',(req,res)=>{clips.remove(z.string().uuid().parse(req.params.id));studio.publish();res.json({ok:true});});
  app.get('/api/clips/:id/media/:kind',(req,res)=>{const c=clips.get(z.string().uuid().parse(req.params.id));const ext=req.params.kind==='video'&&c.video?'webm':req.params.kind==='thumbnail'?c.thumbnail:null;if(!ext)throw new Error('클립 미디어가 없습니다.');res.sendFile(clips.file(c.id,ext));});
  app.post('/api/clips/:id/video',express.raw({type:'video/webm',limit:'20mb'}),(req,res)=>{const metadata=z.object({startedAt:z.coerce.number(),endedAt:z.coerce.number(),hasAudio:z.enum(['true','false']).transform(v=>v==='true')}).parse(req.query);const candidate=clips.get(z.string().uuid().parse(req.params.id));if(!studio.running||!studio.settings.clipBufferEnabled||!studio.settings.autoHighlights||!candidate.creator||candidate.sessionId!==studio.sessionId||metadata.startedAt>candidate.observedAt||metadata.endedAt<candidate.observedAt)throw new Error('관객이 선택한 순간이 허용된 영상 버퍼 안에 있어야 합니다.');const clip=clips.video(candidate.id,req.body,metadata);studio.publish();res.json(clip);});
  app.post('/api/clips/:id/comments',(req,res)=>{const body=z.object({text:z.string().trim().min(1).max(1000),parentId:z.string().uuid().nullable().optional()}).parse(req.body);const comment=clips.comment(z.string().uuid().parse(req.params.id),{...body,name:studio.settings.streamer});studio.publish();res.json(comment);});
  app.delete('/api/clips/:id/comments/:commentId',(req,res)=>{clips.removeComment(z.string().uuid().parse(req.params.id),z.string().uuid().parse(req.params.commentId));studio.publish();res.json({ok:true});});
  app.post('/api/clips/:id/react',async(req,res)=>{const body=z.object({targets:z.array(z.string().max(40)).min(1).max(4),parentId:z.string().uuid().nullable().optional()}).parse(req.body);res.json(await studio.clipFeatures.comments({id:z.string().uuid().parse(req.params.id),...body}));});
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
  app.post('/api/speech',(req,res)=>res.json(studio.receiveSpeech(z.object({id:z.string().uuid(),sessionId:z.string().uuid(),text:z.string().trim().min(1).max(3000),source:z.enum(['keyboard','microphone']).default('keyboard')}).strict().parse(req.body))));
  app.post('/api/chat/display',(req,res)=>res.json(studio.setChatDisplay(z.object({showStreamerMessages:z.boolean()}).strict().parse(req.body).showStreamerMessages)));
  app.post('/api/react',async(req,res)=>res.json(await studio.react(Frame.parse(req.body))));
  soundRoutes(app,studio,sound);
  app.post('/api/audio',express.raw({type:['audio/webm','audio/mp4','audio/ogg','audio/wav'],limit:'8mb'}),async(req,res)=>{
    if(!Buffer.isBuffer(req.body)||!req.body.length)throw new Error('음성 데이터가 비어 있습니다.');
    const controller=new AbortController();const disconnect=()=>{if(!res.writableEnded)controller.abort();};res.on('close',disconnect);
    try{const result=await studio.transcribe(req.body,req.headers['content-type'].split(';')[0],controller.signal);if(!controller.signal.aborted)res.json(result);}finally{res.off('close',disconnect);}
  });
  app.post('/api/moderate',(req,res)=>{const {action,id}=z.object({action:z.enum(['delete','ban','unban','clear']),id:z.string().default('')}).parse(req.body);studio.moderate(action,id);res.json(studio.state());});
  app.get('/api/journal',(req,res)=>res.json(journal.list(z.object({viewerId:z.string().max(80).optional(),query:z.string().max(300).optional(),pinned:z.enum(['true','false']).optional().transform(v=>v==='true'),offset:z.coerce.number().int().min(0).max(4000).default(0),limit:z.coerce.number().int().min(1).max(40).default(30)}).parse(req.query))));
  app.post('/api/journal/:id/pin',(req,res)=>{const id=z.string().uuid().parse(req.params.id);const {pinned}=z.object({pinned:z.boolean()}).parse(req.body);journal.pin(id,pinned);studio.publish();res.json({ok:true});});
  app.delete('/api/journal/:id',(req,res)=>{if(studio.busy)throw new Error('관객 응답이 끝난 뒤 기억을 지울 수 있습니다.');studio.moderate('delete',z.string().uuid().parse(req.params.id));studio.queue=[];studio.publish();res.json({ok:true});});
  app.get('/api/export',(_req,res)=>{res.attachment(`backseat-${studio.sessionId || 'session'}.json`).json({exportedAt:new Date().toISOString(),...studio.state(),seasonsArchive:studio.seasons.data,conversationJournal:journal.data});});
  app.use(express.static(resolve(root,'dist')));
  app.get(['/', '/overlay'],(_req,res)=>res.sendFile(resolve(root,'dist/index.html')));
  app.use((error,_req,res,_next)=>res.status(error instanceof z.ZodError?400:409).json({error:error instanceof z.ZodError?'입력 설정을 확인하세요: '+error.issues.map(i=>i.message).join(', '):error.message || '요청 처리 실패'}));
  const server=await new Promise((resolve,reject)=>{const s=app.listen(port,'127.0.0.1',()=>resolve(s));s.on('error',reject);});
  expectedHost=`127.0.0.1:${server.address().port}`;
  if(localSpeech)speech.start();
  const health=setInterval(()=>studio.publish(),5000);health.unref();
  return {server,studio,url:`http://${expectedHost}`,accessToken:access.token,close:async()=>{clearInterval(health);probe.cancel();studio.close();speech.close();sound.close();server.closeAllConnections();await new Promise(r=>server.close(r));}};
}
if(process.argv[1]&&resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  const service=await startServer({browserConnect:true,developmentOrigin:'http://127.0.0.1:5173'});console.log(`BACKSEAT 개발용 일회용 연결 주소 (공유하지 마세요):\n${service.url}/connect#${service.accessToken}`);
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>service.close().then(()=>process.exit(0)));
}

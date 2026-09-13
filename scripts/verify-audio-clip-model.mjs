import {mkdir,writeFile} from 'node:fs/promises';
import {resolve,join} from 'node:path';
import {randomUUID} from 'node:crypto';
import {CodexProvider} from '../server/codex-provider.js';
import {defaults} from '../shared/defaults.js';
import {ClipFeatures,Clips} from '../server/clips.js';
const out=resolve('artifacts/audio-model-'+Date.now());await mkdir(out);
const provider=new CodexProvider({...process.env,OPENAI_MODEL:'gpt-6-astra',OPENAI_REASONING_EFFORT:'low'});
const report={model:'gpt-6-astra',effort:'low',synthetic:true,userData:false,actualAudioModelInput:false,results:[],passed:false};
const personas=defaults.personas.filter(p=>['momo','new'].includes(p.id)).map(p=>({...p,enabled:true}));
const settings={...defaults,mode:'live',category:'just-chatting',adviceMode:'on-request',autoHighlights:true,chatPace:2,personas};
const started=Date.now()-60000;
try{
 await provider.check();if(!provider.status().configured)throw Error('Official CLI account unavailable');
 for(const scenario of [
  {id:'audio-favorite',sound:{systemSpeech:'안녕하세요 고객님, 저는 오늘부터 떡볶이가 되고 싶습니다... 아 면접 연습인데 메뉴 주문하고 있었네! 하하하하!',classes:[{id:'laugh',label:'Laughter',score:.97,peak:.99,offsetSeconds:2}]},speech:''},
  {id:'microphone-chat',speech:'진지하게 면접 연습하다가 안녕하세요 저는 오늘부터 떡볶이가 되고 싶습니다 해 버렸어. 순간 나도 웃겨서 말을 못 했네 ㅋㅋ',sound:null},
  {id:'quiet-without-sources',speech:'',sound:null}
 ]){
  const now=Date.now(),soundId=randomUUID();
  const sound=scenario.sound?{...scenario.sound,id:soundId,source:'system-output',durationSeconds:4,volumeDb:-14,balance:0,silent:false,language:'ko',caveat:'Synthetic local sound estimate',startedAt:now-5000,endedAt:now-1000}:null;
  const viewerContext=Object.fromEntries(personas.map(p=>[p.id,{joinedAt:p.id==='new'?now:started,heardSounds:p.id==='momo'&&sound?[sound]:[],memories:[],chatHistory:[],previous:null,preferences:[],watchTiming:{receivedAt:now},conversationRhythm:{}}]));
  const liveSpeech=scenario.id==='microphone-chat'?[{messageId:randomUUID(),source:'microphone',text:scenario.speech,capture:{startedAt:now-45000,endedAt:now-41000},hearers:['momo']}]:[];
  const input={liveSpeech,settings,history:[],previous:null,speech:scenario.speech,adviceRequested:false,viewerContext,audience:{members:personas.map(p=>({id:p.id,joinedAt:viewerContext[p.id].joinedAt})),eligible:personas.map(p=>p.id)}};
  const began=Date.now(),result=await provider.react(input,new AbortController().signal),picks=result.observation.clipPicks;
  const valid=picks.every(p=>scenario.id==='audio-favorite'?p.personaId==='momo'&&p.soundId===soundId&&p.speechId==='':scenario.id==='microphone-chat'?p.personaId==='momo'&&p.soundId===''&&p.speechId===liveSpeech[0].messageId:false);
  const clips=new Clips(),studio={settings,running:true,sessionId:'fixture',startedAt:started,now:Date.now,messages:[],log(){},publish(){}};
  const saved=new ClipFeatures(studio,clips).spectatorPicks(result.observation,{speech:scenario.speech,witnesses:personas.map(p=>p.id),capturedAt:now,liveSpeech,heardByViewer:Object.fromEntries(Object.entries(viewerContext).map(([id,p])=>[id,p.heardSounds]))});
  const entry={id:scenario.id,valid,ms:Date.now()-began,input,output:result,saved};report.results.push(entry);await writeFile(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({id:scenario.id,valid,ms:entry.ms,messages:result.observation.messages,picks,saved:saved.map(c=>({observedAt:c.observedAt,creator:c.creator.id}))}));
 }
 report.passed=report.results.every(r=>r.valid);report.soundFavoriteSelected=report.results[0].saved.length>0;report.spokenFavoriteSelected=report.results[1].saved.length>0;
}catch(error){report.error=error.stack;throw error;}
finally{await writeFile(join(out,'result.json'),JSON.stringify(report,null,2));console.log('Evidence: '+out);}
if(!report.passed)process.exitCode=1;

import {startServer} from '../../server/index.js';
import {randomUUID} from 'node:crypto';
const [dataDir,phase,requestId]=process.argv.slice(2);
const crash=code=>process.stdout.write(JSON.stringify({phase,pid:process.pid,execPath:process.execPath,dataDir,requestId})+'\n',()=>process.exit(code));
const app=await startServer({port:0,dataDir,localSpeech:false,provider:{status:()=>({configured:true}),react:async()=>{
  if(phase==='held'){crash(73);return new Promise(()=>{});}
  return {observation:{game:'Just Chatting',scene:'합성 시험',confidence:1,excitement:0,messages:[],arrival:{name:'중단시험관객',personality:'느긋한 잡담을 즐긴다.',values:'서로 존중',sociability:.6,expertise:.3}}};
}}});
const s=app.studio;clearInterval(s.timer);s.configure({...s.settings,mode:'live',category:'just-chatting'});s.start();
const clip=s.clips.create({title:'중단 시험 클립',game:'Just Chatting',scene:'합성 카페 이야기',participants:[],messages:[],source:'spectator',creator:{id:'synthetic-author',name:'합성 작성자'},sessionId:randomUUID()});
await s.autonomy.arrive(requestId,{path:'clip',clip});crash(74);

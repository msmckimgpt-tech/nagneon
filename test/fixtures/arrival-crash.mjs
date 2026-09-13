import {startServer} from '../../server/index.js';
const birth={name:'재시작관객',personality:'차분한 탐험을 좋아하는 관객',values:'같이 알아가기',sociability:.4,expertise:.3};
const mode=process.argv[3];
const service=await startServer({port:0,dataDir:process.argv[2],localSpeech:false,provider:{status:()=>({configured:true}),react:async()=>{
  if(mode==='held'){console.log('HELD');await new Promise(()=>{});}return {observation:{arrival:birth}};
}}});
service.studio.configure({...service.studio.settings,mode:'live'});service.studio.start();
await service.studio.autonomy.arrive(process.argv[4]);console.log('COMMITTED');

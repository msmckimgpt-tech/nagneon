// Synthetic owned renderer/HTTP acceptance; no physical capture or model calls.
const {app,BrowserWindow,session}=require('electron');
const {buildSync}=require('esbuild');
const fs=require('node:fs');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const {createStudioSession}=require('../desktop/session.cjs');
fs.mkdirSync(resolve('artifacts'),{recursive:true});
const out=fs.mkdtempSync(resolve('artifacts/frame-wire-'));
app.setPath('userData',join(out,'profile'));
let service,win;
app.whenReady().then(async()=>{
 try{
  const {startServer}=await import(pathToFileURL(resolve('server/index.js')));
  service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:false})}});
  let accepted=0,baseline;
  service.studio.react=async input=>{
   assert.equal(input.video.sessionId,'00000000-0000-4000-8000-000000000001');
   assert.equal(input.video.sourceId,'00000000-0000-4000-8000-000000000002');
   for(const [index,frame] of input.video.frames.entries()){
    baseline??=frame.image;assert.equal(frame.image,baseline);assert.equal(frame.at,1000+index*500);
   }
   accepted++;return {ok:true};
  };
  win=new BrowserWindow({show:false,webPreferences:{session:createStudioSession(session,service),sandbox:true,contextIsolation:true}});
  await win.loadURL(service.url);
  const code=buildSync({stdin:{contents:"export {api} from './src/api.ts';export {encodeFrameWire} from './shared/frame-wire.js';",resolveDir:process.cwd()},bundle:true,format:'iife',globalName:'TransportProbe',write:false}).outputFiles[0].text;
  await win.webContents.executeJavaScript(code+';void 0');
  const results=await win.webContents.executeJavaScript(`(${async function(){
   const canvas=document.createElement('canvas');canvas.width=960;canvas.height=540;
   const ctx=canvas.getContext('2d'),data=ctx.createImageData(960,540);let seed=123456;
   for(let i=0;i<data.data.length;i+=4){seed=(1664525*seed+1013904223)>>>0;data.data[i]=seed&255;data.data[i+1]=(seed>>>8)&255;data.data[i+2]=(seed>>>16)&255;data.data[i+3]=255;}
   ctx.putImageData(data,0,0);const image=canvas.toDataURL('image/jpeg',.6),results=[];
   if(image.length>320000)throw Error('Fixture exceeds frame limit');
   for(const count of [1,4,8]){
    const input={video:{sessionId:'00000000-0000-4000-8000-000000000001',sourceId:'00000000-0000-4000-8000-000000000002',frames:Array.from({length:count},(_,i)=>({image,at:1000+i*500}))}};
    const binary=TransportProbe.encodeFrameWire(input);if(!binary)throw Error('Native binary encoder unavailable');
    const samples={json:[],binary:[]};
    for(let round=0;round<14;round++)for(const kind of round%2?['binary','json']:['json','binary']){
     const start=performance.now();let value;
     if(kind==='binary')value=await TransportProbe.api('react',input);
     else{const response=await fetch('/api/react',{method:'POST',headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify(input)});if(!response.ok)throw Error('JSON rejected');value=await response.json();}
     if(!value.ok)throw Error('Input rejected');if(round>=4)samples[kind].push(performance.now()-start);
    }
    const median=a=>[...a].sort((a,b)=>a-b)[Math.floor(a.length/2)];
    results.push({frames:count,jsonBytes:new TextEncoder().encode(JSON.stringify(input)).length,binaryBytes:binary.size,jsonMedianMs:median(samples.json),binaryMedianMs:median(samples.binary),samples});
   }
   return results;
  }.toString()})()`);
  assert.equal(accepted,84);
  const report={passed:true,synthetic:true,scope:'Actual renderer encoder and authenticated HTTP route; exact image bytes/source/session/timestamps; mocked react, no model/devices',accepted,results};
  fs.writeFileSync(join(out,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({out,...report}));
 }catch(error){console.error(error);fs.writeFileSync(join(out,'error.txt'),error.stack);process.exitCode=1;}
 finally{win?.destroy();await service?.close();app.exit(process.exitCode||0);}
});

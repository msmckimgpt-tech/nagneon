const {app,BrowserWindow,session}=require('electron');
const {createStudioSession}=require('../desktop/session.cjs');
const {resolve}=require('node:path');
const {mkdirSync,writeFileSync}=require('node:fs');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const folder=resolve('artifacts/ollama-ui-'+Date.now());mkdirSync(folder,{recursive:true});app.setPath('userData',resolve(folder,'profile'));
let service,win;const watchdog=setTimeout(()=>app.exit(2),45000);
app.whenReady().then(async()=>{
  const report={passed:false,synthetic:true,checks:[]};let code=0;
  try{
    const {startServer}=await import(pathToFileURL(resolve('server/index.js')).href),{OllamaProvider}=await import(pathToFileURL(resolve('server/ollama-provider.js')).href);
    const provider=new OllamaProvider({OLLAMA_MODEL:'fixture-local'},async url=>new Response(JSON.stringify(url.endsWith('/show')?{details:{format:'gguf'},capabilities:['completion']}:{done:true,message:{content:JSON.stringify({game:'fixture',scene:'연결 시험',confidence:0,excitement:0,messages:[{personaId:'probe',text:'안녕하세요!',kind:'chat',spoiler:false}]})},prompt_eval_count:10,eval_count:5})));
    const codex={model:'fixture-codex',effort:'low',status:()=>({kind:'codex',configured:true,model:'fixture-codex'}),check:async()=>{},react:async()=>{throw Error('unexpected Codex inference');}};
    service=await startServer({port:0,persist:false,localSpeech:false,providerFactories:{codex:()=>codex,ollama:()=>provider}});await fetch(service.url+'/api/onboarding',{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({skip:true})});
    win=new BrowserWindow({width:1200,height:900,show:true,title:'Ollama integration QA',webPreferences:{session:createStudioSession(session,service),sandbox:true,contextIsolation:true}});
    const js=code=>win.webContents.executeJavaScript(code,true),until=async code=>{for(let i=0;i<200;i++){if(await js(code))return;await new Promise(r=>setTimeout(r,25));}throw Error('UI timeout');};
    await win.loadURL(service.url);await until(`!!document.querySelector('button[title="방송 설정"]')`);await js(`document.querySelector('button[title="방송 설정"]').click()`);
    await until(`!!document.querySelector('select[aria-label="AI 제공처"]')`);
    await js(`document.querySelector('select[aria-label="AI 제공처"]').closest('details').open=true;const select=document.querySelector('select[aria-label="AI 제공처"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'ollama');select.dispatchEvent(new Event('change',{bubbles:true}));`);
    await until(`!!document.querySelector('input[aria-label="Ollama 모델명"]')`);
    await js(`const input=document.querySelector('input[aria-label="Ollama 모델명"]');Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'fixture-local');input.dispatchEvent(new Event('input',{bubbles:true}));`);
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='선택한 제공처 적용').click()`);
    await until(`document.body.textContent.includes('로컬 모델 응답 확인 · 1회')`);assert.equal(await js(`document.body.textContent.includes('OpenAI API 키 (앱 종료 시 삭제)')`),false);
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.includes('로컬 모델 응답 확인 · 1회')).click()`);await until(`document.body.textContent.includes('안녕하세요!')`);
    assert.equal(service.studio.state().connectionProbe.status,'ready');assert.equal(service.studio.state().connectionProbe.tokens,15);
    await js(`(()=>{const select=document.querySelector('select[aria-label="AI 제공처"]');Object.getOwnPropertyDescriptor(HTMLSelectElement.prototype,'value').set.call(select,'codex');select.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent==='선택한 제공처 적용').click()`);
    await until(`document.body.textContent.includes('fixture-codex')&&!document.body.textContent.includes('로컬 모델 응답 확인 · 1회')`);
    assert.equal(service.studio.state().provider.kind,'codex');assert.equal(service.studio.state().connectionProbe.status,'untested');
    report.checks.push('renderer switches Codex to Ollama and back, clears stale readiness', 'local provider copy and no API key field','renderer readiness probe reaches Ollama adapter and displays response');report.passed=true;
  }catch(error){report.error=error.message;code=1;}finally{writeFileSync(resolve(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify({...report,folder}));win?.destroy();await service?.close();clearTimeout(watchdog);app.exit(code);}
});

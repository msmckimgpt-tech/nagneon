// Product renderer against an isolated real server. All chat is synthetic;
// no user's app, profile, microphone or screen is touched.
const {app,BrowserWindow,session}=require('electron');
const {createStudioSession}=require('../desktop/session.cjs');
const {resolve}=require('node:path');
const {mkdirSync,writeFileSync}=require('node:fs');
const {pathToFileURL}=require('node:url');
const assert=require('node:assert/strict');
const {EventEmitter}=require('node:events');
const folder=resolve('artifacts/service-benchmark-ui-'+Date.now());mkdirSync(folder,{recursive:true});
app.setPath('userData',resolve(folder,'profile'));
let service,win;const checks=[],errors=[];
let obsImage;class FixtureObs extends EventEmitter{async connect(){}async disconnect(){this.emit('ConnectionClosed');}async call(type){return type==='GetSceneList'?{scenes:[{sceneName:'격리된 시험 장면'}]}:{imageData:obsImage};}}
const watchdog=setTimeout(()=>{writeFileSync(resolve(folder,'timeout.json'),JSON.stringify({checks,errors}));app.exit(2);},90000);
app.whenReady().then(async()=>{
  let failure;
  try{
    const {startServer}=await import(pathToFileURL(resolve('server/index.js')).href);
    service=await startServer({port:0,dataDir:resolve(folder,'data'),localSpeech:false,obsClientFactory:()=>new FixtureObs(),provider:{status:()=>({configured:true,model:'fixture',kind:'fixture'}),react:async()=>({observation:{game:'fixture',scene:'synthetic scene',confidence:0,excitement:0,messages:[]},usage:{total_tokens:0}})}});
    await fetch(service.url+'/api/onboarding',{method:'POST',headers:{Authorization:'Bearer '+service.accessToken,'Content-Type':'application/json','X-Backseat-Client':'studio'},body:JSON.stringify({skip:true})});
    win=new BrowserWindow({width:1440,height:960,show:true,title:'BACKSEAT Benchmark QA',webPreferences:{session:createStudioSession(session,service),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
    win.webContents.on('console-message',(_event,level,message)=>{if(level===3)errors.push(message);});
    const js=code=>win.webContents.executeJavaScript(code,true);
    const until=async code=>{const end=Date.now()+8000;while(!await js(code)){if(Date.now()>end)throw Error('UI timeout: '+code);await new Promise(r=>setTimeout(r,40));}};
    const button=async text=>{await until(`Array.from(document.querySelectorAll('button')).some(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled)`);await js(`Array.from(document.querySelectorAll('button')).find(b=>b.textContent.trim()===${JSON.stringify(text)}&&!b.disabled).click()`);};
    await win.loadURL(service.url);await until(`!!document.querySelector('.chat-scroll')`);
    await js(`document.querySelector('button[title="방송 설정"]').click()`);await button('분위기·훈수');
    await until(`document.querySelectorAll('.crowd-presets button').length===4`);
    const original=structuredClone(service.studio.settings);
    await js(`document.querySelectorAll('.crowd-presets button')[3].click()`);
    assert.equal(service.studio.settings.chatPace,original.chatPace,'draft must not save automatically');
    await button('설정 저장');await until(`!document.querySelector('[role="dialog"]')`);
    assert.equal(service.studio.settings.chatPace,8);assert.equal(service.studio.settings.crowdStyle,'stadium');
    assert.deepEqual(service.studio.settings.personas,original.personas);assert.equal(service.studio.settings.adviceMode,original.adviceMode);
    checks.push('preset saves only crowd/pace/lurk settings and preserves audience/advice');
    obsImage='data:image/jpeg;base64,'+(await win.webContents.capturePage()).toJPEG(35).toString('base64');
    await js(`document.querySelector('.obs-panel').open=true`);await button('OBS 연결');
    await until(`document.querySelector('[aria-label="OBS 장면"]')?.options.length===2`);
    await js(`(()=>{const s=document.querySelector('[aria-label="OBS 장면"]');s.value='격리된 시험 장면';s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
    await button('이 장면 함께 보기');await until(`document.querySelector('.obs-panel').textContent.includes('함께 보는 OBS 장면: 격리된 시험 장면')`);
    await button('선택 장면 미리보기');await until(`document.querySelector('.obs-panel img')?.naturalWidth>0`);
    assert.ok(service.obsInput.sourceId);assert.ok(!('password' in service.studio.state().obsInput));
    await button('OBS 연결 해제');await until(`!document.querySelector('.obs-panel img')`);
    assert.equal(service.obsInput.phase,'disconnected');
    checks.push('OBS connect, scene selection, actual JPEG preview and disconnect through renderer');
    service.studio.configure({...service.studio.settings,mode:'live'});service.studio.start();
    const person=service.studio.settings.personas.find(p=>p.enabled);
    const make=(i,text)=>({id:'fixture-'+i,personaId:person.id,name:person.name,color:person.color,kind:'chat',time:Date.now(),text:text||`검증 채팅 ${i} · 함께 게임을 보고 있어요.`});
    service.studio.messages=Array.from({length:100},(_,i)=>make(i));service.studio.publish();
    await until(`document.querySelectorAll('.chat-scroll .chat-line').length===100`);
    await js(`document.querySelector('.chat-scroll').scrollTop=100`);
    await until(`document.querySelector('.chat-scroll').scrollTop<200`);await new Promise(r=>setTimeout(r,100));
    const before=await js(`document.querySelector('.chat-scroll').scrollTop`);
    assert.ok(before<200,'reader remains at chosen position before new chat');
    service.studio.messages.push(make(100,'다음 게임은 무엇인가요?'));service.studio.publish();
    await until(`!!document.querySelector('.chat-jump')`);
    assert.ok(Math.abs(await js(`document.querySelector('.chat-scroll').scrollTop`)-before)<3);
    await button('새 채팅 보기 ↓');await until(`!document.querySelector('.chat-jump')`);
    assert.ok(await js(`(()=>{const p=document.querySelector('.chat-scroll');return p.scrollHeight-p.scrollTop-p.clientHeight<3})()`));
    checks.push('incoming chat preserves reader position; jump restores bottom follow');
    await js(`document.querySelector('.chat-briefing').open=true`);
    await until(`document.querySelector('.briefing-content').textContent.includes('다음 게임은 무엇인가요?')`);
    service.studio.moderate('delete','fixture-100');service.studio.publish();
    await until(`!document.querySelector('.briefing-content').textContent.includes('다음 게임은 무엇인가요?')`);
    checks.push('briefing renders source chat and immediately removes deleted message');
    await win.webContents.capturePage().then(img=>writeFileSync(resolve(folder,'desktop.png'),img.toPNG()));
    for(const [width,height] of [[1100,700],[600,800]]){
      win.setSize(width,height);await new Promise(r=>setTimeout(r,120));
      assert.ok(await js(`document.documentElement.scrollWidth<=innerWidth+1`),'horizontal overflow');
      assert.ok(await js(`document.querySelector('.chat-scroll').getBoundingClientRect().height>=100`),'chat remains usable with briefing open');
      await win.webContents.capturePage().then(img=>writeFileSync(resolve(folder,`layout-${width}.png`),img.toPNG()));
    }
    checks.push('briefing and chat fit 1440, 1100 and 600 pixel layouts');
    service.studio.stop();service.studio.start();await until(`document.querySelectorAll('.chat-scroll .chat-line').length===0`);
    assert.equal(await js(`!!document.querySelector('.chat-jump')`),false);
    checks.push('new session clears history and follow notification');
    assert.deepEqual(errors,[]);
  }catch(error){failure=error;console.error(error.stack);if(win&&!win.isDestroyed()){writeFileSync(resolve(folder,'failure.png'),(await win.webContents.capturePage()).toPNG());writeFileSync(resolve(folder,'failure-layout.json'),JSON.stringify(await win.webContents.executeJavaScript(`(()=>{const p=document.querySelector('.chat-scroll');return {top:p?.scrollTop,height:p?.clientHeight,total:p?.scrollHeight,messages:p?.querySelectorAll('.chat-line').length,body:document.body.innerText.slice(-1500)}})()`),null,2));}}
  finally{if(win&&!win.isDestroyed())win.destroy();if(service)await service.close();clearTimeout(watchdog);writeFileSync(resolve(folder,'result.json'),JSON.stringify({passed:!failure,checks,errors,error:failure?.message,syntheticMessages:true,folder},null,2));console.log(JSON.stringify({passed:!failure,checks,folder}));app.exit(failure?1:0);}
});

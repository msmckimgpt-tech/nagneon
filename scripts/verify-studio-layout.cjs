// Isolated renderer geometry and interaction checks. No real devices or LLM.
const {app,BrowserWindow,session}=require('electron');
const {createStudioSession}=require('../desktop/session.cjs');
const {resolve,join}=require('node:path');
const {pathToFileURL}=require('node:url');
const {mkdirSync,writeFileSync,mkdtempSync}=require('node:fs');
const assert=require('node:assert/strict');
mkdirSync('artifacts',{recursive:true});
const folder=mkdtempSync(resolve('artifacts/studio-layout-'));
app.setPath('userData',join(folder,'profile'));
let service,win;const report={folder,synthetic:true,modelCalls:0,checks:[]};
setTimeout(()=>{console.error('Layout watchdog expired');app.exit(2);},60000).unref();
app.whenReady().then(async()=>{
  try{
    const {startServer}=await import(pathToFileURL(resolve('server/index.js')).href);
    service=await startServer({port:0,persist:false,localSpeech:false,provider:{
      status:()=>({configured:true,model:'Synthetic layout check',effort:'low'}),
      react:async()=>{report.modelCalls++;return {observation:{game:'Synthetic',scene:'',confidence:0,excitement:0,messages:[]}};},
    }});
    win=new BrowserWindow({show:false,width:1440,height:980,webPreferences:{session:createStudioSession(session,service),sandbox:true,contextIsolation:true,backgroundThrottling:false}});
    const js=code=>win.webContents.executeJavaScript(code,true);
    const until=async code=>{const end=Date.now()+7000;while(!await js(code)){if(Date.now()>end)throw Error('Timed out: '+code);await new Promise(r=>setTimeout(r,40));}};
    await win.loadURL(service.url);
    await until(`!!document.querySelector('.welcome-shell')`);
    await js(`[...document.querySelectorAll('button')].find(b=>b.textContent.trim()==='나중에 설정하기').click()`);
    await until(`!!document.querySelector('.studio-starter')`);
    for(const [width,height] of [[1440,940],[1280,720],[1024,611],[951,611],[1920,1080]]){
      win.setContentSize(width,height);
      await new Promise(r=>setTimeout(r,120));
      const geometry=await js(`(()=>{
        const rect=selector=>{const r=document.querySelector(selector).getBoundingClientRect();return {top:r.top,bottom:r.bottom,left:r.left,right:r.right,height:r.height}};
        return {width:innerWidth,height:innerHeight,scrollWidth:document.documentElement.scrollWidth,bodyHeight:document.documentElement.scrollHeight,
          composer:rect('.chat-compose'),controls:rect('.stage-controls'),chat:rect('.chat-scroll'),stage:rect('.stage'),preview:rect('.preview'),guide:rect('.studio-starter'),column:rect('.stage-column'),
          buttons:[...document.querySelectorAll('.stage-controls button')].map(b=>({title:b.title,text:b.textContent,left:b.getBoundingClientRect().left,right:b.getBoundingClientRect().right}))};
      })()`);
      report.checks.push({case:'desktop',...geometry});
      assert.equal(geometry.scrollWidth,width,'no horizontal page overflow');
      for(const key of ['composer','controls','preview']){
        assert.ok(geometry[key].top>=0&&geometry[key].bottom<=height+1,`${width}x${height} ${key} fits viewport: ${JSON.stringify(geometry)}`);
      }
      assert.ok(geometry.chat.height>=70,'chat remains readable');
      for(const button of geometry.buttons)assert.ok(button.left>=geometry.controls.left&&button.right<=geometry.controls.right,`control clipped: ${JSON.stringify(button)}`);
      assert.ok(geometry.preview.height>=190,'preview remains usable');
      assert.ok(geometry.guide.top>=geometry.stage.bottom,'first-run guidance remains below controls');
      const before=geometry.composer;
      await js(`document.querySelector('.stage-column').scrollTop=99999`);
      const context=await js(`({composer:document.querySelector('.chat-compose').getBoundingClientRect().top,crew:document.querySelector('.crew').getBoundingClientRect().bottom,scroll:document.querySelector('.stage-column').scrollTop})`);
      assert.ok(context.scroll>0&&context.crew<=height,'context panels remain reachable');
      assert.equal(context.composer,before.top,'context scroll does not move composer');
      await js(`document.querySelector('.stage-column').scrollTop=0`);
      writeFileSync(join(folder,`studio-${width}x${height}.png`),(await win.webContents.capturePage()).toPNG());
    }
    service.studio.configure({...service.studio.settings,mode:'rehearsal'});service.studio.start();
    await until(`!document.querySelector('[aria-label="관객에게 말하기"]').disabled`);
    await js(`(()=>{const input=document.querySelector('[aria-label="관객에게 말하기"]');input.focus();Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(input,'레이아웃 검증 인사');input.dispatchEvent(new Event('input',{bubbles:true}));})()`);
    await until(`!document.querySelector('[title="보내기"]').disabled`);
    await js(`document.querySelector('[title="보내기"]').click()`);
    await until(`document.querySelector('.chat-scroll').textContent.includes('레이아웃 검증 인사')`);
    assert.equal(report.modelCalls,0);report.checks.push({case:'composer delivers rehearsal message without LLM'});
    for(let i=0;i<35;i++)service.studio.addMessage('streamer','스크롤 검증 '+i,'streamer');
    await until(`document.querySelector('.chat-scroll').textContent.includes('스크롤 검증 34')`);
    assert.equal(await js(`(()=>{const pane=document.querySelector('.chat-scroll');return pane.scrollHeight>pane.clientHeight&&pane.scrollHeight-pane.clientHeight-pane.scrollTop<2&&document.querySelector('.stage-column').scrollTop===0;})()`),true);
    report.checks.push({case:'incoming messages scroll only the chat pane'});service.studio.stop();
    for(const [width,height] of [[900,650],[620,720]]){
      win.setContentSize(width,height);await new Promise(r=>setTimeout(r,100));
      assert.equal(await js('document.documentElement.scrollWidth<=innerWidth'),true);
      await js(`document.querySelector('.chat-compose').scrollIntoView({block:'end'})`);
      assert.equal(await js(`document.querySelector('.chat-compose').getBoundingClientRect().bottom<=innerHeight+1`),true);
      report.checks.push({case:'narrow composer remains reachable',width,height});
    }
    await js(`[...document.querySelectorAll('nav button')].find(b=>b.textContent.includes('나의 관객')).click()`);
    await until(`!!document.querySelector('.workspace:not(.studio-workspace)')`);
    report.checks.push({case:'other tabs keep normal document scrolling'});
    report.passed=true;
  }catch(error){report.passed=false;report.error=error.stack;process.exitCode=1;}
  finally{writeFileSync(join(folder,'result.json'),JSON.stringify(report,null,2));console.log(JSON.stringify(report));win?.destroy();await service?.close();app.exit(process.exitCode||0);}
});

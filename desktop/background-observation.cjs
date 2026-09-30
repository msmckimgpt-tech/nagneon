const FLAG='--backseat-background-observe';
const rendererState="(()=>({ready:!!document.querySelector('.app-shell,.welcome-shell'),version:document.querySelector('[aria-label=\"앱 버전\"]')?.textContent,bridge:!!window.backseat}))()";

function createBackgroundObservation(argv,{schedule=setTimeout,cancel=clearTimeout,pause=clearInterval,resume=setInterval,delay=ms=>new Promise(done=>setTimeout(done,ms)),write=value=>console.log(JSON.stringify(value))}={}){
  let active=argv.includes(FLAG),quitTimer,studio;
  return {
    get active(){return active;},
    windowOptions(){return active?{show:false}:{};},
    attach(value){
      if(!active)return;
      studio=value;
      pause(studio.timer);studio.timer=null;
    },
    open(argv){
      if(argv.includes(FLAG))return false;
      if(active){
        active=false;cancel(quitTimer);quitTimer=undefined;
        if(studio){studio.timer=resume(()=>studio.pump(),250);studio.timer.unref?.();}
        write({kind:'background-observation-cancelled',reason:'interactive-open'});
      }
      return true;
    },
    dispose(){active=false;cancel(quitTimer);quitTimer=undefined;},
    async ready({app,window,profile}){
      if(!active)return false;
      let result={kind:'background-observation',passed:false,version:app.getVersion(),profile};
      try{
        let renderer;
        for(let attempt=0;attempt<100&&active;attempt++){
          renderer=await window.webContents.executeJavaScript(rendererState);
          if(renderer.ready)break;
          await delay(50);
        }
        if(!active)return false;
        if(!renderer?.ready||!renderer.bridge)throw Error('숨긴 앱 화면이 준비되지 않았습니다.');
        if(renderer.version&&renderer.version!==app.getVersion())throw Error('앱 화면과 패키지 버전이 다릅니다.');
        if(window.isVisible())throw Error('관측용 앱 창이 화면에 표시됐습니다.');
        if(studio.running)throw Error('관측 실행 중 방송이 시작됐습니다.');
        if(studio.timer!==null)throw Error('관측 실행의 주기 작업이 정지되지 않았습니다.');
        const provider=studio.provider.status();
        result={...result,passed:true,visible:false,rendererReady:true,displayedVersion:renderer.version||null,running:false,periodicWorkPaused:studio.timer===null,provider:{kind:provider.kind,model:provider.model,effort:provider.effort}};
      }catch(error){result.error=error.message;}
      if(!active)return false;
      try{write(result);}finally{quitTimer=schedule(()=>{quitTimer=undefined;if(active)app.quit();},1500);quitTimer?.unref?.();}
      return true;
    },
  };
}
module.exports={createBackgroundObservation};

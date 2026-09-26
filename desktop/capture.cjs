// The display choice is single-use and belongs only to the studio's main frame.
function attachCapture({session,ipcMain,desktopCapturer,main,platform=process.platform}){
  let selected=null;
  const pending=new Map();
  // Native thumbnail capture cannot be cancelled. Coalesce unfinished work so
  // closing/reopening the picker never piles up another capture of every app.
  const list=(key,options)=>{
    if(pending.has(key))return pending.get(key);
    const work=Promise.resolve().then(()=>desktopCapturer.getSources(options));
    pending.set(key,work);work.then(()=>pending.delete(key),()=>pending.delete(key));return work;
  };
  const visible=s=>! /^(BACKSEAT|Nagneon|NAGNEON)/.test(s.name);
  const kind=s=>s.id.startsWith('screen:')?'screen':'window';
  const trusted=event=>{if(event.sender!==main.webContents||event.senderFrame!==main.webContents.mainFrame)throw Error('메인 방송 창에서 화면을 선택하세요.');};
  session.setDisplayMediaRequestHandler(async(request,callback)=>{
    try{
      if(request.frame!==main.webContents.mainFrame||!selected)return callback({});
      const choice=selected;selected=null;
      const sources=await desktopCapturer.getSources({types:['screen','window'],thumbnailSize:{width:0,height:0}});
      const source=sources.find(s=>s.id===choice.id);
      callback(source?{video:source,...(choice.systemAudio&&request.audioRequested&&(platform==='win32'||platform==='darwin')?{audio:'loopback'}:{})}:{});
    }catch{callback({});}
  });
  ipcMain.handle('capture:sources',async event=>{
    trusted(event);
    return(await list('names',{types:['window','screen'],thumbnailSize:{width:0,height:0}}))
      .filter(visible).map(s=>({id:s.id,name:s.name,kind:kind(s),thumbnail:''}));
  });
  ipcMain.handle('capture:previews',async(event,type)=>{
    trusted(event);if(!['screen','window'].includes(type))throw Error('미리보기 종류 오류');
    return(await list('preview:'+type,{types:[type],thumbnailSize:{width:300,height:170}}))
      .filter(visible).map(s=>({id:s.id,name:s.name,kind:kind(s),thumbnail:s.thumbnail.isEmpty?.()?'':s.thumbnail.toDataURL()}));
  });
  ipcMain.handle('capture:select',async(event,id,systemAudio=false)=>{trusted(event);if(typeof id!=='string'||typeof systemAudio!=='boolean')throw Error('화면 선택 오류');selected={id,systemAudio};});
}
module.exports={attachCapture};

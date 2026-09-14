import OBSWebSocket from 'obs-websocket-js/json';
import {randomUUID} from 'node:crypto';
import {VIDEO_FRAME_CHARS,VIDEO_FRESH_MS} from '../shared/temporal-policy.js';

// Connection-scoped credentials never enter settings, state or model input.
// The only OBS requests this adapter makes are reads of a list and a picture.
export class ObsInput {
  constructor({createClient=()=>new OBSWebSocket(),now=Date.now,timeoutMs=8000,onChange=()=>{},onEnd=()=>{}}={}){
    Object.assign(this,{createClient,now,timeoutMs,onChange,onEnd});this.client=null;this.controller=null;this.scenes=[];this.selectedScene='';this.sourceId='';this.phase='disconnected';this.error='';this.busy=false;
  }
  snapshot(){return {phase:this.phase,scenes:[...this.scenes],selectedScene:this.selectedScene,sourceId:this.sourceId,error:this.error};}
  end(){const id=this.sourceId;this.sourceId='';this.selectedScene='';if(id)this.onEnd(id);}
  disconnect(){
    const client=this.client;this.client=null;this.controller?.abort();this.controller=null;this.end();this.scenes=[];this.phase='disconnected';this.busy=false;this.error='';
    if(client)void client.disconnect().catch(()=>{});
    this.onChange();
  }
  async bounded(promise,client,timeout=this.timeoutMs){
    const signal=AbortSignal.any([this.controller.signal,AbortSignal.timeout(timeout)]);let abort;
    try{return await Promise.race([promise,new Promise((_,reject)=>{abort=()=>reject(new Error('OBS 요청이 취소되었거나 응답 시간이 지났습니다.'));if(signal.aborted)abort();else signal.addEventListener('abort',abort,{once:true});})]);}
    finally{signal.removeEventListener('abort',abort);}
  }
  async connect({port=4455,password=''}={}){
    if(!Number.isInteger(port)||port<1||port>65535||typeof password!=='string'||password.length>1024)throw Error('OBS 포트와 비밀번호를 확인해주세요.');
    this.disconnect();const client=this.createClient();this.client=client;this.controller=new AbortController();this.phase='connecting';this.onChange();
    client.on('ConnectionClosed',()=>{if(this.client===client){this.disconnect();this.error='OBS 연결이 끊겼습니다. 다시 연결해주세요.';this.onChange();}});
    client.on('ConnectionError',()=>{});
    try{
      await this.bounded(client.connect(`ws://127.0.0.1:${port}`,password,{rpcVersion:1,eventSubscriptions:0}),client);
      if(this.client!==client)throw Error('cancelled');
      const result=await this.bounded(client.call('GetSceneList'),client);
      if(this.client!==client)throw Error('cancelled');
      this.scenes=[...new Set((result.scenes||[]).map(s=>s.sceneName).filter(name=>typeof name==='string'&&name.length>0&&name.length<=240))].slice(0,100);
      this.phase='connected';this.onChange();return this.snapshot();
    }catch{
      if(this.client===client){this.disconnect();this.error='OBS 연결에 실패했습니다. OBS의 WebSocket 서버, 포트와 비밀번호를 확인해주세요.';this.onChange();}
      throw Error('OBS 연결을 완료하지 못했습니다.');
    }
  }
  select(scene){
    if(this.phase!=='connected'||!this.scenes.includes(scene))throw Error('연결된 OBS 장면 목록에서 선택해주세요.');
    this.end();this.selectedScene=scene;this.sourceId=randomUUID();this.onChange();return this.snapshot();
  }
  async frame(sourceId){
    if(!sourceId||sourceId!==this.sourceId||this.phase!=='connected')throw Error('OBS 장면 연결이 바뀌었습니다. 다시 선택해주세요.');
    if(this.busy)throw Error('OBS 화면을 읽고 있습니다. 잠시 후 다시 시도해주세요.');
    const client=this.client,scene=this.selectedScene,at=this.now();this.busy=true;
    try{
      const result=await this.bounded(client.call('GetSourceScreenshot',{sourceName:scene,imageFormat:'jpg',imageWidth:960,imageCompressionQuality:65}),client,VIDEO_FRESH_MS);
      if(this.client!==client||sourceId!==this.sourceId)throw Error('OBS 장면 연결이 바뀌었습니다.');
      const image=typeof result.imageData==='string'?result.imageData.replace(/^data:image\/jpg;/,'data:image/jpeg;'):null;
      if(typeof image!=='string'||image.length>VIDEO_FRAME_CHARS||!/^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/.test(image)||this.now()-at>VIDEO_FRESH_MS)throw Error('OBS 화면을 제때 읽지 못했습니다.');
      return {image,at,sourceId};
    }catch{
      if(this.client===client&&this.sourceId===sourceId){this.end();this.error='OBS 화면을 읽지 못했습니다. 장면을 다시 선택해주세요.';this.onChange();}
      throw Error('OBS 화면을 읽지 못했습니다.');
    }finally{if(this.client===client)this.busy=false;}
  }
}

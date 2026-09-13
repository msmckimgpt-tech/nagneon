// The server owns requests through their finally blocks, including CLI media
// deletion. Sending an abort alone does not mean that cleanup has finished.
export class RequestLifetime {
  constructor(){this.controller=new AbortController();this.pending=new Set();this.closing=null;}
  run(work,signal){
    const combined=signal?AbortSignal.any([signal,this.controller.signal]):this.controller.signal;
    let resolve,reject;
    const operation=new Promise((done,fail)=>{resolve=done;reject=fail;});
    this.pending.add(operation);
    const remove=()=>this.pending.delete(operation);
    operation.then(remove,remove);
    // Preserve the provider's synchronous start (live speech can preempt it in
    // this same turn), but register ownership before invoking any callbacks.
    (async()=>{
      this.controller.signal.throwIfAborted();
      const result=await work(combined);
      this.controller.signal.throwIfAborted();
      return result;
    })().then(resolve,reject);
    return operation;
  }
  close(){
    if(!this.closing){
      this.controller.abort(new Error('앱 종료로 요청을 취소했습니다.'));
      this.closing=Promise.allSettled([...this.pending]).then(()=>{});
    }
    return this.closing;
  }
}

export function ownProviderRequests(provider,lifetime){
  // Scope belongs to one server. Never leave closed wrappers on a reusable
  // provider or carry a previous server's abort signal into its replacement.
  const wrappers=new Map();
  return new Proxy(provider,{get(target,name,receiver){
    const value=Reflect.get(target,name,receiver);
    const signalIndex=name==='react'?1:name==='transcribe'?2:null;
    if(signalIndex===null||typeof value!=='function')return value;
    if(!wrappers.has(name))wrappers.set(name,(...args)=>lifetime.run(signal=>{args[signalIndex]=signal;return Reflect.apply(target[name],target,args);},args[signalIndex]));
    return wrappers.get(name);
  }});
}

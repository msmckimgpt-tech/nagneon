export class SpeechOperationTimeoutError extends Error {
  readonly code='SPEECH_OPERATION_TIMEOUT';
  constructor(message='음성 처리 응답을 기다리는 시간이 너무 길어졌습니다.'){super(message);this.name='SpeechOperationTimeoutError';}
}

export function speechTimedOut(error:unknown):error is SpeechOperationTimeoutError {
  return error instanceof SpeechOperationTimeoutError||(
    error instanceof Error&&'code' in error&&(error as Error&{code?:string}).code==='SPEECH_OPERATION_TIMEOUT'
  );
}

function abortError(signal?:AbortSignal){
  return signal?.reason instanceof Error?signal.reason:new DOMException('음성 처리 취소','AbortError');
}

export function runSpeechOperation<T>(
  operation:(signal:AbortSignal)=>Promise<T>,
  options:{signal?:AbortSignal;timeoutMs:number;timeoutMessage?:string}
):Promise<T>{
  const {signal,timeoutMs,timeoutMessage}=options;
  if(signal?.aborted)return Promise.reject(abortError(signal));
  const controller=new AbortController();
  return new Promise<T>((resolve,reject)=>{
    let settled=false,timer:ReturnType<typeof setTimeout>|undefined;
    const cleanup=()=>{if(timer!==undefined)clearTimeout(timer);signal?.removeEventListener('abort',onAbort);};
    const resolveOnce=(value:T)=>{if(settled)return;settled=true;cleanup();resolve(value);};
    const rejectOnce=(error:unknown)=>{if(settled)return;settled=true;cleanup();reject(error);};
    const onAbort=()=>{if(!controller.signal.aborted)controller.abort(signal?.reason);rejectOnce(abortError(signal));};
    signal?.addEventListener('abort',onAbort,{once:true});
    if(Number.isFinite(timeoutMs)&&timeoutMs>0)timer=setTimeout(()=>{
      const error=new SpeechOperationTimeoutError(timeoutMessage);
      if(!controller.signal.aborted)controller.abort(error);
      rejectOnce(error);
    },timeoutMs);
    try{Promise.resolve(operation(controller.signal)).then(resolveOnce,rejectOnce);}catch(error){rejectOnce(error);}
  });
}

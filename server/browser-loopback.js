// HTTP clients reject these ports even when the OS successfully binds them.
// Keep in sync with https://fetch.spec.whatwg.org/#port-blocking and Chromium
// net/base/port_util.cc when upgrading the bundled browser/runtime.
const restrictedPorts=new Set([
  0,1,7,9,11,13,15,17,19,20,21,22,23,25,37,42,43,53,69,77,79,87,95,
  101,102,103,104,109,110,111,113,115,117,119,123,135,137,139,143,161,
  179,389,427,465,512,513,514,515,526,530,531,532,540,548,554,556,563,
  587,601,636,989,990,993,995,1719,1720,1723,2049,3659,4045,4190,5060,
  5061,6000,6566,6665,6666,6667,6668,6669,6679,6697,10080,
]);

export function browserPortAllowed(port){
  return Number.isInteger(port)&&port>0&&port<=65535&&!restrictedPorts.has(port);
}

export function validateBrowserListenPort(port){
  if(port!==0&&!browserPortAllowed(port))throw Object.assign(
    new Error('브라우저에서 사용할 수 없는 앱 포트입니다. 자동 포트(0) 또는 다른 포트를 선택하세요.'),
    {code:'ERR_BROWSER_PORT'},
  );
}

function listenOnce(server,port,signal){
  return new Promise((resolve,reject)=>{
    const finish=error=>{
      server.off('error',failed);server.off('listening',ready);server.off('close',closed);
      signal?.removeEventListener('abort',aborted);
      error?reject(error):resolve();
    };
    const failed=error=>finish(error),ready=()=>finish();
    const closed=()=>finish(signal?.reason||new Error('앱 연결 준비가 중지되었습니다.'));
    const aborted=()=>finish(signal.reason);
    server.once('error',failed);server.once('listening',ready);server.once('close',closed);
    signal?.addEventListener('abort',aborted,{once:true});
    try{
      signal?.throwIfAborted();
      // Node owns cancellation of a bind still waiting for its listening event.
      server.listen({port,host:'127.0.0.1',signal});
    }catch(error){finish(error);}
  });
}

async function closeRejected(server){
  await new Promise((resolve,reject)=>{
    server.close(error=>error&&error.code!=='ERR_SERVER_NOT_RUNNING'?reject(error):resolve());
    server.closeAllConnections?.();
  });
}

export async function listenBrowserLoopback(server,{port=0,signal,maxAttempts=32}={}){
  validateBrowserListenPort(port);
  if(!Number.isInteger(maxAttempts)||maxAttempts<1||maxAttempts>32)throw new RangeError('앱 포트 재시도 횟수가 올바르지 않습니다.');
  for(let attempt=0;attempt<maxAttempts;attempt++){
    signal?.throwIfAborted();
    await listenOnce(server,port,signal);
    if(signal?.aborted){await closeRejected(server);signal.throwIfAborted();}
    if(browserPortAllowed(server.address()?.port))return server;
    // Do not expose an unusable URL, relax browser security or reuse a probe's
    // released port. Rebind the actual owned server before returning it.
    await closeRejected(server);
    if(port!==0)break;
  }
  throw Object.assign(new Error('사용 가능한 앱 연결 포트를 찾지 못했습니다. 앱을 다시 실행해주세요.'),{code:'ERR_BROWSER_PORT'});
}

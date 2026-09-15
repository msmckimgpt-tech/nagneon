const {join,resolve,isAbsolute}=require('node:path');
const {existsSync}=require('node:fs');

function packagedRuntime(resources,{cache,catalog=existsSync(join(resources,'runtime-components.json'))?require('../shared/runtime-catalog.json'):null}={}){
  const speech=join(resources,'speech');
  const microphone=join(speech,'microphone-model');
  const accurate=existsSync(join(microphone,'manifest.json'));
  const runtime={
    codexBin:join(resources,'codex','bin','codex.exe'),
    speech:{gpuLibraries:join(speech,'gpu'),python:join(speech,'python','python.exe'),worker:join(speech,'speech_worker.py'),model:accurate?microphone:join(speech,'model'),modelName:accurate?'medium':'small'},
    clips:{python:join(speech,'python','python.exe'),worker:join(speech,'clip_inspector.py')},
    clipPerception:{worker:join(speech,'clip_perception.py')},
    sound:{python:join(speech,'python','python.exe'),worker:join(resources,'sound','sound_worker.py'),model:join(resources,'sound','model'),speechModel:join(speech,'model')}
  };
  if(catalog){
    if(!cache||!isAbsolute(cache))throw Error('실행 구성 저장 경로를 확인하세요.');
    const component=id=>{const item=catalog.components?.find(c=>c.id===id);if(!item||!/^[a-f0-9]{64}$/.test(item.contentId))throw Error('실행 구성 목록을 확인하세요.');return join(cache,'installed',id+'-'+item.contentId.slice(0,32),'resources');};
    runtime.components={catalog,cache};
    runtime.speech.python=join(component('audio'),'speech/python/python.exe');
    runtime.clips.python=runtime.speech.python;runtime.sound.python=runtime.speech.python;
    runtime.speech.model=join(component('microphone'),'speech/microphone-model');runtime.speech.modelName='medium';
    runtime.speech.gpuLibraries=join(component('gpu'),'speech/gpu');
    runtime.sound.model=join(component('sound'),'sound/model');runtime.sound.speechModel=join(component('sound'),'speech/model');
  }
  for(const file of [runtime.codexBin,runtime.speech.worker,runtime.clips.worker,runtime.clipPerception.worker,runtime.sound.worker,...(catalog?[]:[runtime.speech.python,join(runtime.speech.model,'model.bin'),join(runtime.sound.model,'yamnet.onnx')])]){
    if(!existsSync(file))throw new Error('앱의 실행 파일 일부가 없습니다. 설치 파일의 무결성을 확인하거나 다시 설치하세요.');
  }
  return runtime;
}
function profileDirectory(argv){
  const arg=argv.find(a=>a.startsWith('--nagneon-profile=')||a.startsWith('--backseat-profile='));
  if(!arg)return null;
  const path=arg.slice(arg.indexOf('=')+1);
  if(!isAbsolute(path))throw new Error('별도 프로필은 절대 경로로 지정하세요.');
  return resolve(path);
}
module.exports={packagedRuntime,profileDirectory};

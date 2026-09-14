const {join,resolve,isAbsolute}=require('node:path');
const {existsSync}=require('node:fs');

function packagedRuntime(resources){
  const speech=join(resources,'speech');
  const microphone=join(speech,'microphone-model');
  const accurate=existsSync(join(microphone,'manifest.json'));
  const runtime={
    codexBin:join(resources,'codex','bin','codex.exe'),
    speech:{python:join(speech,'python','python.exe'),worker:join(speech,'speech_worker.py'),model:accurate?microphone:join(speech,'model'),modelName:accurate?'medium':'small'},
    clips:{python:join(speech,'python','python.exe'),worker:join(speech,'clip_inspector.py')},
    clipPerception:{worker:join(speech,'clip_perception.py')},
    sound:{python:join(speech,'python','python.exe'),worker:join(resources,'sound','sound_worker.py'),model:join(resources,'sound','model'),speechModel:join(speech,'model')}
  };
  for(const file of [runtime.codexBin,runtime.speech.python,runtime.speech.worker,runtime.clips.worker,runtime.clipPerception.worker,join(runtime.speech.model,'model.bin'),runtime.sound.worker,join(runtime.sound.model,'yamnet.onnx')]){
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

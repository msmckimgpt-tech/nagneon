import {OpenAIProvider} from './provider.js';
import {z} from 'zod';
import {Observation} from './schema.js';

// Local constrained decoding needs the same lengths, ranges and UUIDs that
// acceptance validates. The hosted-provider schema omits some of these bounds.
const localFormat=z.toJSONSchema(Observation);

export class OllamaProvider extends OpenAIProvider {
  constructor(env=process.env,fetcher=fetch){
    super({},fetcher);const url=new URL(env.OLLAMA_BASE_URL||'http://127.0.0.1:11434');
    if(url.protocol!=='http:'||url.hostname!=='127.0.0.1'||url.username||url.password||url.search||url.hash||url.pathname!=='/')throw Error('Ollama는 이 PC의 127.0.0.1 주소로 연결해주세요.');
    this.base=url.origin;this.model=env.OLLAMA_MODEL||'';this.effort='local';this.transcriptionModel='로컬 음성 인식';this.available=false;this.vision=false;this.message='Ollama와 사용할 로컬 모델을 설정해주세요.';
    this.contextSize=Number(env.OLLAMA_CONTEXT_SIZE||65536);if(!Number.isInteger(this.contextSize)||this.contextSize<4096||this.contextSize>131072)throw Error('Ollama 문맥 크기는 4096~131072로 설정해주세요.');
  }
  status(){return {kind:'ollama',configured:this.available,model:this.model||'모델 미선택',effort:this.effort,transcriptionModel:this.transcriptionModel,authMessage:this.message,vision:this.vision,webSearch:false};}
  async localRequest(path,body,signal,timeout=60000){
    const combined=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(timeout)]);
    try{
      const response=await this.fetcher(this.base+'/api/'+path,{method:'POST',headers:{'Content-Type':'application/json'},redirect:'error',body:JSON.stringify(body),signal:combined});
      if(!response.ok)throw Error('request');const reader=response.body.getReader();let length=0;const chunks=[];
      try{for(;;){const {done,value}=await reader.read();if(done)break;length+=value.length;if(length>2*1024*1024)throw Error('size');chunks.push(value);}}
      finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      combined.throwIfAborted();return JSON.parse(Buffer.concat(chunks).toString('utf8'));
    }catch{if(combined.aborted)throw Error('Ollama 요청이 취소되었거나 응답 시간이 지났습니다.');throw Error('Ollama 응답을 받지 못했습니다. 로컬 서버와 모델 설정을 확인해주세요.');}
  }
  async check(signal){
    this.available=false;this.vision=false;
    if(!this.model||this.model.length>200||/\s|cloud/i.test(this.model)){this.message='사용할 로컬 모델 이름을 지정해주세요. 클라우드 모델은 지원하지 않습니다.';return this.status();}
    try{
      const info=await this.localRequest('show',{model:this.model,verbose:false},signal,8000);
      if(info.remote_model||info.remote_host||info.details?.format!=='gguf'||!info.capabilities?.includes('completion'))throw Error('local model');
      const limits=Object.entries(info.model_info||{}).filter(([key,value])=>key.endsWith('.context_length')&&Number.isFinite(value)).map(([,value])=>value);
      if(limits.length&&Math.max(...limits)<this.contextSize)throw Error('context capacity');
      this.vision=info.capabilities.includes('vision');this.available=true;this.message=this.vision?'Ollama 로컬 모델 준비됨 · 화면 입력 지원':'Ollama 로컬 모델 준비됨 · 텍스트 입력 전용';
    }catch{this.message='로컬 GGUF 모델을 확인하지 못했습니다. Ollama 실행과 모델 이름을 확인해주세요.';}
    return this.status();
  }
  async react(args,signal){
    signal?.throwIfAborted();await this.check(signal);signal?.throwIfAborted();
    if(!this.available)throw Error(this.message);
    if(args.settings.webSearch&&args.adviceRequested)throw Error('로컬 모델은 웹 검색을 지원하지 않습니다. 웹 검색 설정을 끄고 다시 요청해주세요.');
    const payload=this.payload(args),content=payload.input[0].content,images=content.filter(p=>p.type==='input_image').map(p=>p.image_url);
    if(images.length&&!this.vision)throw Error('선택한 로컬 모델은 화면 입력을 지원하지 않습니다. 화면 지원 모델을 선택하거나 화면 연결을 해제해주세요.');
    if(images.some(image=>!/^data:image\/(png|jpeg);base64,[A-Za-z0-9+/=]+$/.test(image)))throw Error('로컬 모델에 전달할 화면 형식이 올바르지 않습니다.');
    const text=content.filter(p=>p.type==='input_text').map(p=>p.text).join('\n');
    // Conservative text allowance; image tokenization remains model-specific.
    if(Buffer.byteLength(payload.instructions+text,'utf8')+images.length*4096+2300>this.contextSize)throw Error('로컬 모델의 문맥 예산을 넘었습니다. 문맥 크기를 늘리거나 참여 관객·화면 입력을 줄여주세요.');
    const result=await this.localRequest('chat',{model:this.model,stream:false,format:localFormat,options:{num_predict:2200,num_ctx:this.contextSize},messages:[{role:'system',content:payload.instructions+'\n웹 검색 기능은 제공되지 않는다. 검색을 했다고 주장하지 않는다.'},{role:'user',content:text,...(images.length?{images:images.map(image=>image.slice(image.indexOf(',')+1))}:{})}]},signal);
    if(result.done!==true||result.done_reason==='length'||result.message?.tool_calls?.length)throw Error('로컬 모델 응답이 완료되지 않았습니다. 모델과 출력 길이를 확인해주세요.');
    try{const observation=Observation.parse(JSON.parse(result.message.content));const count=n=>Number.isSafeInteger(n)&&n>=0?n:0;return {observation,usage:{input_tokens:count(result.prompt_eval_count),output_tokens:count(result.eval_count),total_tokens:count(result.prompt_eval_count)+count(result.eval_count)}};}
    catch{throw Error('로컬 모델 응답 형식이 올바르지 않아 채팅을 표시하지 않았습니다.');}
  }
  async transcribe(){throw Error('Ollama 음성 API는 사용하지 않습니다. 로컬 음성 인식을 준비해주세요.');}
}

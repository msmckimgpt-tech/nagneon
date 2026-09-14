import {OpenAIProvider,format} from './provider.js';
import {Observation} from './schema.js';

// Translate the same audience request; never convert API keys into CLI tokens.
// These endpoints are fixed so credentials cannot follow a user supplied URL.
export class HostedProvider extends OpenAIProvider{
  constructor(config,env=process.env,fetcher=fetch){
    super({},fetcher);this.kind=config.kind;this.model=config.model;this.effort='provider-default';
    this.key=env[this.kind==='claude'?'ANTHROPIC_API_KEY':'GEMINI_API_KEY']||'';
    this.transcriptionModel='로컬 음성 인식';
  }
  status(){return {kind:this.kind,configured:!!this.key,model:this.model,effort:this.effort,transcriptionModel:this.transcriptionModel,webSearch:false,authMessage:this.key?'API 키 입력됨 · 응답 확인으로 모델 접근을 시험하세요.':'이 제공처의 API 키를 입력해주세요.'};}
  async check(){return this.status();}
  async react(args,signal){
    if(!this.key)throw Error('선택한 제공처의 API 키를 입력해주세요.');
    if(args.settings.webSearch&&args.adviceRequested)throw Error('이 제공처의 웹 검색은 아직 지원하지 않습니다. 웹 검색 설정을 끄고 다시 요청해주세요.');
    const payload=this.payload(args),content=payload.input[0].content;
    const image=part=>{
      const match=/^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/.exec(part.image_url);
      if(!match)throw Error('화면 입력 형식이 올바르지 않습니다.');return {mime:'image/'+match[1],data:match[2]};
    };
    let url,headers,body;
    if(this.kind==='claude'){
      // Claude rejects numeric/string bounds in the transport schema. Full
      // Observation validation remains mandatory on the returned value.
      const schema=JSON.parse(JSON.stringify(format.schema,(key,value)=>['minLength','maxLength','minimum','maximum','maxItems','minItems'].includes(key)?undefined:value));
      url='https://api.anthropic.com/v1/messages';headers={'x-api-key':this.key,'anthropic-version':'2023-06-01'};
      body={model:this.model,max_tokens:4096,system:payload.instructions,messages:[{role:'user',content:content.map(p=>{
        if(p.type==='input_text')return {type:'text',text:p.text};const i=image(p);return {type:'image',source:{type:'base64',media_type:i.mime,data:i.data}};
      })}],output_config:{format:{type:'json_schema',schema}}};
    }else{
      url='https://generativelanguage.googleapis.com/v1beta/models/'+encodeURIComponent(this.model)+':generateContent';headers={'x-goog-api-key':this.key};
      body={systemInstruction:{parts:[{text:payload.instructions}]},contents:[{role:'user',parts:content.map(p=>{
        if(p.type==='input_text')return {text:p.text};const i=image(p);return {inlineData:{mimeType:i.mime,data:i.data}};
      })}],generationConfig:{maxOutputTokens:8192,responseMimeType:'application/json',responseJsonSchema:format.schema}};
    }
    const combined=AbortSignal.any([...(signal?[signal]:[]),AbortSignal.timeout(60000)]);
    let result;
    try{
      const response=await this.fetcher(url,{method:'POST',headers:{...headers,'Content-Type':'application/json'},body:JSON.stringify(body),redirect:'error',signal:combined});
      if(!response.ok){await response.body?.cancel();throw Error('status '+response.status);}
      const reader=response.body.getReader(),chunks=[];let bytes=0;
      try{for(;;){const next=await reader.read();if(next.done)break;bytes+=next.value.length;if(bytes>2*1024*1024)throw Error('size');chunks.push(next.value);}}
      finally{await reader.cancel().catch(()=>{});reader.releaseLock();}
      result=JSON.parse(Buffer.concat(chunks).toString('utf8'));combined.throwIfAborted();
    }catch{
      if(combined.aborted)throw Error('모델 요청이 취소되었거나 응답 시간이 지났습니다.');
      throw Error('AI API 요청에 실패했습니다. 선택한 모델의 접근 권한·API 키·사용량을 확인해주세요.');
    }
    let raw,input=0,output=0;
    if(this.kind==='claude'){
      if(result.stop_reason!=='end_turn'||result.content?.some(p=>p.type!=='text'))throw Error('Claude 응답이 완전한 텍스트로 끝나지 않았습니다.');
      raw=result.content.map(p=>p.text).join('');input=result.usage?.input_tokens;output=result.usage?.output_tokens;
    }else{
      const candidate=result.candidates?.[0];
      if(candidate?.finishReason!=='STOP'||candidate.content?.parts?.some(p=>p.functionCall))throw Error('Gemini 응답이 완료되지 않았습니다. 모델의 출력 제한을 확인해주세요.');
      raw=candidate.content?.parts?.filter(p=>!p.thought).map(p=>p.text||'').join('');input=result.usageMetadata?.promptTokenCount;output=(result.usageMetadata?.candidatesTokenCount||0)+(result.usageMetadata?.thoughtsTokenCount||0);
    }
    const count=n=>Number.isSafeInteger(n)&&n>=0?n:0;
    try{return {observation:Observation.parse(JSON.parse(raw)),usage:{input_tokens:count(input),output_tokens:count(output),total_tokens:count(input)+count(output)}};}
    catch{throw Error('모델 응답 형식이 올바르지 않아 채팅을 표시하지 않았습니다.');}
  }
  async transcribe(){throw Error('로컬 음성 인식을 준비해주세요.');}
}

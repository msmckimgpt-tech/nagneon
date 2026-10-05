import {encodeFrameWire,FRAME_WIRE_TYPE} from '../shared/frame-wire.js';
export async function api<T=unknown>(path:string,body?:unknown,method='POST'):Promise<T>{
  const binary=path==='react'&&method==='POST'?encodeFrameWire(body):null;
  const response=await fetch('/api/'+path,{method,headers:{'Content-Type':binary?FRAME_WIRE_TYPE:'application/json','X-Backseat-Client':'studio'},...(body===undefined?{}:{body:binary??JSON.stringify(body)})});
  const data=await response.json();if(!response.ok)throw new Error(data.error || '연결에 실패했습니다.');return data;
}

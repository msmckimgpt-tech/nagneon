export async function api<T=unknown>(path:string,body?:unknown,method='POST'):Promise<T>{
  const response=await fetch('/api/'+path,{method,headers:{'Content-Type':'application/json','X-Backseat-Client':'studio'},...(body===undefined?{}:{body:JSON.stringify(body)})});
  const data=await response.json();if(!response.ok)throw new Error(data.error || '연결에 실패했습니다.');return data;
}

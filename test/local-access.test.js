import test from 'node:test';
import assert from 'node:assert/strict';
import {startServer} from '../server/index.js';
import {request} from 'node:http';

const setup=options=>startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:true})},...options});
const headers=service=>({Authorization:'Bearer '+service.accessToken,'X-Backseat-Client':'studio','Content-Type':'application/json'});

test('every data transport and the UI require a per-run capability, before executing handlers',async t=>{
  const service=await setup();t.after(()=>service.close());
  for(const path of ['/','/overlay','/api/state','/api/events','/api/export','/api/clips/00000000-0000-4000-8000-000000000000/media/video','/connect']){
    const response=await fetch(service.url+path);assert.equal(response.status,401,path);assert.equal(response.headers.get('set-cookie'),null);
    assert.ok(!(await response.text()).includes(service.accessToken));
  }
  const denied=await fetch(service.url+'/api/start',{method:'POST',headers:{'X-Backseat-Client':'studio'}});assert.equal(denied.status,401);assert.equal(service.studio.running,false);
  const state=await(await fetch(service.url+'/api/state',{headers:headers(service)})).json();assert.equal(state.running,false);assert.ok(!JSON.stringify(state).includes(service.accessToken));
  const events=await fetch(service.url+'/api/events',{headers:headers(service)});assert.equal(events.status,200);const reader=events.body.getReader();assert.match(new TextDecoder().decode((await reader.read()).value),/^data: /);await reader.cancel();
});

test('wrong, malformed and another instance tokens fail; origin and write guards still apply',async t=>{
  const a=await setup(),b=await setup();t.after(async()=>{await a.close();await b.close();});
  for(const token of ['',a.accessToken+'x','a'.repeat(64),b.accessToken])assert.equal((await fetch(a.url+'/api/state',{headers:{Authorization:'Bearer '+token}})).status,401);
  assert.equal((await fetch(a.url+'/api/state',{headers:{...headers(a),Origin:'https://foreign.example'}})).status,403);
  assert.equal((await fetch(a.url+'/api/state',{headers:{...headers(a),Origin:'http://127.0.0.1:5173'}})).status,403);
  const forged=await new Promise((resolve,reject)=>{const req=request(a.url+'/api/state',{headers:{...headers(a),Host:'127.0.0.1:123'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});assert.equal(forged,403);
  assert.equal((await fetch(a.url+'/api/start',{method:'POST',headers:{Authorization:'Bearer '+a.accessToken}})).status,403);
  assert.equal((await fetch(a.url+'/api/session',{method:'POST',headers:headers(a),body:JSON.stringify({token:a.accessToken})})).status,404);
});

test('development browser bootstrap is explicit, one-use and leaves credentials out of response body',async t=>{
  const service=await setup({browserConnect:true});t.after(()=>service.close());
  const url=service.url;assert.equal((await fetch(url+'/connect')).status,200);
  const connect=token=>fetch(url+'/api/session',{method:'POST',headers:{'X-Backseat-Client':'studio','Content-Type':'application/json'},body:JSON.stringify({token})});
  assert.equal((await connect('wrong')).status,401);
  const connected=await connect(service.accessToken);assert.equal(connected.status,200);assert.deepEqual(await connected.json(),{ok:true});
  const cookie=connected.headers.get('set-cookie');assert.match(cookie,/HttpOnly; SameSite=Strict/);assert.doesNotMatch(cookie,/Expires|Max-Age/);
  assert.equal((await connect(service.accessToken)).status,401);
  const h={Cookie:cookie.split(';')[0]};assert.equal((await fetch(url+'/api/state',{headers:h})).status,200);
  assert.equal((await fetch(url+'/api/state',{headers:{Cookie:h.Cookie+'; '+h.Cookie}})).status,401);
  assert.equal((await fetch(url+'/api/state',{headers:{...h,Origin:'http://127.0.0.1:99'}})).status,403);
});

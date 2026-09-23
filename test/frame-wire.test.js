import test from 'node:test';
import assert from 'node:assert/strict';
import {encodeFrameWire,FRAME_WIRE_TYPE} from '../shared/frame-wire.js';
import {decodeFrameWire} from '../server/frame-wire.js';
import {Frame} from '../server/schema.js';
import {startServer} from '../server/index.js';
const decode=value=>{const bytes=Buffer.from(value,'base64');bytes.toBase64=()=>bytes.toString('base64');return bytes;};
const image=(n=20)=>'data:image/jpeg;base64,'+Buffer.alloc(n,117).toString('base64');
const fixture=()=>({speech:'합성 발언',video:{sessionId:'00000000-0000-4000-8000-000000000001',sourceId:'00000000-0000-4000-8000-000000000002',frames:[{image:image(),at:1500,still:{since:1000,samples:2}},{image:'data:image/png;base64,AQID',at:2000}]}});
const pack=async input=>Buffer.from(await encodeFrameWire(input,decode).arrayBuffer());
function envelope(metadata,bytes=Buffer.alloc(0)){
 const json=Buffer.from(JSON.stringify(metadata)),header=Buffer.alloc(8);header.write('NGF1');header.writeUInt32BE(json.length,4);return Buffer.concat([header,json,bytes]);
}
test('binary frames round trip exact bytes, timestamps, source/session and still evidence without mutation',async()=>{
 const input=fixture(),before=structuredClone(input);
 assert.deepEqual(decodeFrameWire(await pack(input)),input);
 assert.deepEqual(Frame.parse(decodeFrameWire(await pack(input))),Frame.parse(input));
 assert.deepEqual(input,before);
 assert.deepEqual(decodeFrameWire(await pack({image:image(),speech:'한 장'})),{image:image(),speech:'한 장'});
});
test('encoder uses JSON fallback without native conversion, images or canonical data',()=>{
 for(const input of [{speech:'text'},{obsSourceId:'source'},{image:'data:image/jpeg;base64,AB=='},{image:'bad'},null])assert.equal(encodeFrameWire(input,decode),null);
 assert.equal(encodeFrameWire(fixture(),null),null);
});
test('decoder rejects truncation, trailing data, invalid metadata, mime and frame counts',async()=>{
 const valid=await pack(fixture());
 for(const body of [valid.subarray(0,7),valid.subarray(0,-1),Buffer.concat([valid,Buffer.from([0])]),Buffer.from('BAD1xxxx'),envelope([]),envelope({image:{mime:'svg',bytes:1}},Buffer.from([0])),envelope({image:{mime:'jpeg',bytes:-1}}),envelope({image:{mime:'jpeg',bytes:1,extra:true}},Buffer.from([0])),envelope({video:{frames:Array(9).fill({image:{mime:'jpeg',bytes:1},at:1})}},Buffer.alloc(9))])assert.throws(()=>decodeFrameWire(body));
 const oversized=Buffer.from(valid);oversized.writeUInt32BE(65537,4);assert.throws(()=>decodeFrameWire(oversized));
 const highBitMagic=Buffer.from(valid);highBitMagic[0]|=128;assert.throws(()=>decodeFrameWire(highBitMagic));
 const badUtf8=Buffer.concat([Buffer.from('NGF1'),Buffer.from([0,0,0,1]),Buffer.from([255])]);assert.throws(()=>decodeFrameWire(badUtf8));
});
test('wire and restored JSON retain existing per-frame and aggregate limits',async()=>{
 const large=fixture();large.video.frames[0].image=image(240000);const bytes=await pack(large);assert.throws(()=>decodeFrameWire(bytes));
 // The restored JSON includes metadata as well as expanded images.
 const body=envelope({image:{mime:'jpeg',bytes:2_000_000},extra:'x'.repeat(60000)},Buffer.alloc(2_000_000));
 assert.equal(decodeFrameWire(body).image, 'data:image/jpeg;base64,'+Buffer.alloc(2_000_000).toString('base64'));
 const tooLarge=Buffer.alloc(3*1024*1024+1);assert.throws(()=>decodeFrameWire(tooLarge));
});
test('real route preserves auth, client boundary and Frame validation before react',async t=>{
 const service=await startServer({port:0,persist:false,localSpeech:false,provider:{status:()=>({configured:false})}});t.after(()=>service.close());
 const seen=[];service.studio.react=async input=>{seen.push(input);return {ok:true};};
 const input=fixture(),body=await pack(input),headers={'Content-Type':FRAME_WIRE_TYPE,'X-Backseat-Client':'studio',Authorization:'Bearer '+service.accessToken};
 const post=(body,headers)=>fetch(service.url+'/api/react',{method:'POST',headers,body});
 let response=await post(body,{'Content-Type':FRAME_WIRE_TYPE,'X-Backseat-Client':'studio'});assert.equal(response.status,401);await response.text();
 response=await post(body,{'Content-Type':FRAME_WIRE_TYPE,Authorization:headers.Authorization});assert.equal(response.status,403);await response.text();
 response=await post(body,headers);assert.equal(response.status,200);await response.json();assert.deepEqual(seen,[Frame.parse(input)]);
 const invalid=fixture();invalid.video.frames.reverse();response=await post(await pack(invalid),headers);assert.equal(response.status,400);await response.json();assert.equal(seen.length,1);
 response=await post(body.subarray(0,-1),headers);assert.equal(response.ok,false);await response.json();assert.equal(seen.length,1);
 response=await post(Buffer.alloc(3*1024*1024+1),headers);assert.equal(response.ok,false);await response.json();assert.equal(seen.length,1);
 response=await post(JSON.stringify(input),{...headers,'Content-Type':'application/json'});assert.equal(response.status,200);await response.json();assert.deepEqual(seen[1],seen[0]);
});

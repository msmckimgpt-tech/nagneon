import {FRAME_JSON_LIMIT,FRAME_META_LIMIT} from '../shared/frame-wire.js';
import {VIDEO_MAX_FRAMES,VIDEO_FRAME_CHARS} from '../shared/temporal-policy.js';

export function decodeFrameWire(body){
  const invalid=()=>{throw Object.assign(Error('화면 전송 데이터를 확인하세요.'),{status:400});};
  if(!Buffer.isBuffer(body)||body.length<8||body.length>FRAME_JSON_LIMIT||!body.subarray(0,4).equals(Buffer.from('NGF1')))invalid();
  const size=body.readUInt32BE(4);
  if(!size||size>FRAME_META_LIMIT||size>body.length-8)invalid();
  let input;
  try{input=JSON.parse(new TextDecoder('utf-8',{fatal:true}).decode(body.subarray(8,8+size)));}catch{invalid();}
  if(!input||typeof input!=='object'||Array.isArray(input))invalid();
  let offset=8+size,count=0;
  const restore=(entry,max)=>{
    if(!entry||typeof entry!=='object'||Array.isArray(entry)||Object.keys(entry).sort().join(',')!=='bytes,mime'||!['jpeg','png'].includes(entry.mime)||!Number.isSafeInteger(entry.bytes)||entry.bytes<1||entry.bytes>body.length-offset)invalid();
    const prefix=`data:image/${entry.mime};base64,`;
    if(prefix.length+4*Math.ceil(entry.bytes/3)>max)invalid();
    const image=prefix+body.subarray(offset,offset+entry.bytes).toString('base64');
    offset+=entry.bytes;count++;return image;
  };
  if(input.image!==undefined)input.image=restore(input.image,2_800_000);
  if(input.video!==undefined){
    if(!input.video||!Array.isArray(input.video.frames)||input.video.frames.length>VIDEO_MAX_FRAMES)invalid();
    for(const frame of input.video.frames){
      if(!frame||typeof frame!=='object'||Array.isArray(frame))invalid();
      frame.image=restore(frame.image,VIDEO_FRAME_CHARS);
    }
  }
  if(!count||offset!==body.length||Buffer.byteLength(JSON.stringify(input))>FRAME_JSON_LIMIT)invalid();
  return input;
}

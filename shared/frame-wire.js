// Versioned request framing; downstream Frame and witness contracts stay unchanged.
import {VIDEO_MAX_FRAMES} from './temporal-policy.js';
export const FRAME_WIRE_TYPE='application/vnd.nagneon.frame-v1';
export const FRAME_JSON_LIMIT=3*1024*1024;
export const FRAME_META_LIMIT=64*1024;
export function encodeFrameWire(input,decode=Uint8Array.fromBase64){
  if(typeof decode!=='function'||!input||typeof input!=='object')return null;
  const chunks=[];
  const replace=(image)=>{
    if(typeof image!=='string'||image.length>2_800_000)throw Error('Not an image');
    const match=/^data:image\/(jpeg|png);base64,([A-Za-z0-9+/]+={0,2})$/.exec(image);
    if(!match)throw Error('Not a canonical image');
    const bytes=decode(match[2],{lastChunkHandling:'strict'});
    if(typeof bytes.toBase64!=='function'||bytes.toBase64()!==match[2])throw Error('Noncanonical base64');
    chunks.push(bytes);return {mime:match[1],bytes:bytes.byteLength};
  };
  try{
    const copy={...input};
    if(copy.image!==undefined)copy.image=replace(copy.image);
    if(copy.video!==undefined){
      if(!Array.isArray(copy.video?.frames)||copy.video.frames.length>VIDEO_MAX_FRAMES)return null;
      copy.video={...copy.video,frames:copy.video.frames.map(frame=>({...frame,image:replace(frame.image)}))};
    }
    if(!chunks.length||chunks.length>VIDEO_MAX_FRAMES+1)return null;
    const metadata=new TextEncoder().encode(JSON.stringify(copy));
    if(metadata.length>FRAME_META_LIMIT)return null;
    const header=new Uint8Array(8);header.set([78,71,70,49]);
    new DataView(header.buffer).setUint32(4,metadata.length,false);
    const body=new Blob([header,metadata,...chunks],{type:FRAME_WIRE_TYPE});
    return body.size<=FRAME_JSON_LIMIT?body:null;
  }catch{return null;}
}

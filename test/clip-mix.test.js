import test from 'node:test';
import assert from 'node:assert/strict';
import {mixClipAudio} from '../src/clip-audio.ts';

function setup(t,{failGain=false}={}){
  const original={AudioContext:globalThis.AudioContext,MediaStream:globalThis.MediaStream},contexts=[];
  const track=()=>({stops:0,stop(){this.stops++;}}),output=track();
  class Stream{constructor(tracks){this.tracks=tracks;}getAudioTracks(){return this.tracks;}getTracks(){return this.tracks;}}
  class Context{
    constructor(){this.destination={speaker:true};this.edges=[];this.gains=[];this.closed=0;contexts.push(this);}
    createMediaStreamDestination(){return this.target={stream:new Stream([output])};}
    createMediaStreamSource(stream){return {connect:node=>{this.edges.push({stream,node});return node;}};}
    createGain(){if(failGain)throw Error('gain failed');const gain={gain:{value:0},connect:node=>{this.edges.push({gain,node});return node;}};this.gains.push(gain);return gain;}
    resume(){return Promise.resolve();}close(){this.closed++;return Promise.resolve();}
  }
  globalThis.AudioContext=Context;globalThis.MediaStream=Stream;
  t.after(()=>{for(const [key,value] of Object.entries(original)){if(value===undefined)delete globalThis[key];else globalThis[key]=value;}});
  const source=()=>{const clone=track();return {readyState:'live',cloneCalls:0,clone(){this.cloneCalls++;return clone;},copy:clone};};
  return {contexts,output,source,Stream};
}
test('microphone and system audio mix once without a playback-speaker connection',t=>{
  const h=setup(t),a=h.source(),b=h.source();const result=mixClipAudio([new h.Stream([a]),new h.Stream([b]),new h.Stream([a])]);
  assert.equal(result.tracks.length,1);assert.equal(a.cloneCalls,1);assert.equal(b.cloneCalls,1);
  const ctx=h.contexts[0];assert.deepEqual(ctx.gains.map(g=>g.gain.value),[.5,.5]);assert.ok(ctx.edges.every(e=>e.node!==ctx.destination));
  result.close();result.close();assert.equal(a.copy.stops,1);assert.equal(b.copy.stops,1);assert.equal(h.output.stops,1);assert.equal(ctx.closed,1);
});
test('partial mixer construction failure releases clones, output and context',t=>{
  const h=setup(t,{failGain:true}),a=h.source(),b=h.source();assert.throws(()=>mixClipAudio([new h.Stream([a,b])]),/gain failed/);assert.equal(a.copy.stops,1);assert.equal(b.cloneCalls,0);assert.equal(h.output.stops,1);assert.equal(h.contexts[0].closed,1);
});
test('empty audio source does not open an AudioContext',t=>{
  const h=setup(t);const result=mixClipAudio([]);result.close();assert.equal(result.tracks.length,0);assert.equal(h.contexts.length,0);
});
test('a single input is cloned without an audio graph and leaves the original live',t=>{
  const h=setup(t),a=h.source();let originalStops=0;a.stop=()=>originalStops++;
  const result=mixClipAudio([new h.Stream([a]),new h.Stream([a])]);
  assert.deepEqual(result.tracks,[a.copy]);assert.equal(a.cloneCalls,1);assert.equal(h.contexts.length,0);
  result.close();result.close();assert.equal(a.copy.stops,1);assert.equal(originalStops,0);assert.equal(a.readyState,'live');
});
test('ended inputs do not require a mixer beside a single live input',t=>{
  const h=setup(t),a=h.source(),ended=h.source();ended.readyState='ended';
  const result=mixClipAudio([new h.Stream([ended,a])]);assert.deepEqual(result.tracks,[a.copy]);assert.equal(ended.cloneCalls,0);assert.equal(h.contexts.length,0);result.close();
});
test('single input clone failure neither opens a mixer nor stops the original',t=>{
  const h=setup(t),a=h.source();a.clone=()=>{throw Error('clone failed');};
  assert.throws(()=>mixClipAudio([new h.Stream([a])]),/clone failed/);assert.equal(h.contexts.length,0);assert.equal(a.readyState,'live');
});

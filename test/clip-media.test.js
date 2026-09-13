import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const module={exports:{}};
const code=ts.transpileModule(readFileSync(new URL('../src/ClipMedia.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
vm.runInNewContext(code,{module,exports:module.exports,require:createRequire(new URL('../src/ClipMedia.tsx',import.meta.url))});
const {ClipMedia}=module.exports;
const render=clip=>renderToStaticMarkup(React.createElement(ClipMedia,{clip:{id:'fixture',video:false,audio:false,thumbnail:null,...clip}}));
test('audio clip renders an accessible audio player without video or autoplay',()=>{
  const html=render({audio:true});assert.match(html,/<audio /);assert.match(html,/controls=""/);assert.match(html,/preload="metadata"/);assert.match(html,/aria-label="관객이 남긴 음성 클립"/);assert.match(html,/\/media\/audio/);assert.doesNotMatch(html,/<video|<img|autoplay/i);
});
test('old video and thumbnail records retain their correct players',()=>{
  assert.match(render({video:true}),/<video .*\/media\/video/);assert.doesNotMatch(render({video:true}),/<audio/);assert.match(render({thumbnail:'png'}),/<img .*\/media\/thumbnail/);assert.equal(render({}),'');
});
test('selecting a different clip replaces player identity rather than continuing the old source',()=>{
  const a=ClipMedia({clip:{id:'one',audio:true,video:false}}),b=ClipMedia({clip:{id:'two',audio:true,video:false}});assert.notEqual(a.key,b.key);assert.notEqual(a.props.clip.id,b.props.clip.id);assert.match(render({id:'two',audio:true}),/\/two\/media\/audio/);
});

test('separated voice has its own hidden audio and toggle while legacy mixed clips explain their limitation',()=>{
  const html=render({video:true,voice:true,audioLayout:'separate',videoStartedAt:1000,voiceStartedAt:1010,voiceEndedAt:16000});assert.match(html,/\/media\/voice/);assert.match(html,/hidden=""/);assert.match(html,/스트리머 음성 켜짐/);assert.doesNotMatch(html,/autoplay/i);
  assert.doesNotMatch(render({video:true}),/aria-pressed/);assert.match(render({audio:true,audioLayout:'microphone-only'}),/스트리머 음성 켜짐/);
});

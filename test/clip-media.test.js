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
vm.runInNewContext(code,{module,exports:module.exports,require:createRequire(import.meta.url)});
const {ClipMedia}=module.exports;
const render=clip=>renderToStaticMarkup(React.createElement(ClipMedia,{clip:{id:'fixture',video:false,audio:false,thumbnail:null,...clip}}));
test('audio clip renders an accessible audio player without video or autoplay',()=>{
  const html=render({audio:true});assert.match(html,/<audio /);assert.match(html,/controls=""/);assert.match(html,/preload="metadata"/);assert.match(html,/aria-label="관객이 남긴 음성 클립"/);assert.match(html,/\/media\/audio/);assert.doesNotMatch(html,/<video|<img|autoplay/i);
});
test('old video and thumbnail records retain their correct players',()=>{
  assert.match(render({video:true}),/<video .*\/media\/video/);assert.doesNotMatch(render({video:true}),/<audio/);assert.match(render({thumbnail:'png'}),/<img .*\/media\/thumbnail/);assert.equal(render({}),'');
});
test('selecting a different clip replaces player identity rather than continuing the old source',()=>{
  const a=ClipMedia({clip:{id:'one',audio:true,video:false}}),b=ClipMedia({clip:{id:'two',audio:true,video:false}});assert.notEqual(a.key,b.key);assert.notEqual(a.props.src,b.props.src);
});

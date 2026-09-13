import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const module={exports:{}},require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync(new URL('../src/CommunityGallery.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
vm.runInNewContext(code,{module,exports:module.exports,require:name=>name==='./api'?{api:()=>assert.fail('SSR must not submit requests')}:name.endsWith('.css')?{}:require(name)});
const {CommunityGallery}=module.exports;
test('gallery server rendering exposes compact list, categories, recommendation counts and escaped legacy titles',()=>{
  const html=renderToStaticMarkup(React.createElement(CommunityGallery,{state:{settings:{streamer:'테스트',mode:'live'},messages:[],audience:{posts:[{id:'legacy',name:'관객',text:'<script>alert(1)</script>',time:1,kind:'ai',comments:[],votes:['momo']}]},running:false,busy:false},onError:()=>{}}));
  for(const label of ['테스트 갤러리','번호','말머리','제목','글쓴이','작성일','추천','전체글','추천글','공지','갤러리 검색','글쓰기'])assert.ok(html.includes(label),label);
  assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/<script>/);
  assert.doesNotMatch(html,/관객 후일담|모델 1회|관객들이 읽기/);
});
test('hotclip and gallery surfaces provide no audience selection or manual artifact generation command',()=>{
 for(const file of ['HotClips.tsx','CommunityGallery.tsx']){
  const source=readFileSync(new URL('../src/'+file,import.meta.url),'utf8');
  assert.doesNotMatch(source,/setTargets|\/react`|community\/reflect|모델 1회|다른 관객도 함께 보기/);
 }
});

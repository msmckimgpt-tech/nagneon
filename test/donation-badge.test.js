import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
const module={exports:{}};
const code=ts.transpileModule(readFileSync(new URL('../src/DonationBadge.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
vm.runInNewContext(code,{module,exports:module.exports,require:createRequire(import.meta.url)});
const render=donation=>renderToStaticMarkup(React.createElement(module.exports.DonationBadge,{donation}));
test('the shared live, remembered and clipped gift badge shows points and preserves anonymity',()=>{
  assert.equal(render(undefined),'');assert.match(render({amount:24,anonymous:true}),/후원 24P · 익명/);assert.doesNotMatch(render({amount:24,anonymous:false}),/익명/);
});

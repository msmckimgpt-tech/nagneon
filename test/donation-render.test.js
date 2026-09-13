import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createRequire} from 'node:module';
import vm from 'node:vm';
import ts from 'typescript';
import React from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {donationMessage} from '../server/chat-attention.js';
const module={exports:{}},require=createRequire(import.meta.url);
const code=ts.transpileModule(readFileSync(new URL('../src/Donations.tsx',import.meta.url),'utf8'),{compilerOptions:{target:ts.ScriptTarget.ES2022,module:ts.ModuleKind.CommonJS,jsx:ts.JsxEmit.ReactJSX}}).outputText;
vm.runInNewContext(code,{module,exports:module.exports,require:id=>id==='./donations.css'||id==='./AccessibleDialog'||id==='./api'?{}:require(id),Date,setTimeout,clearTimeout});
const render=messages=>renderToStaticMarkup(React.createElement(module.exports.DonationToast,{messages}));

test('public toast renders anonymous identity and points, escaping donation text',()=>{
  const message=donationMessage({id:'gift',at:Date.now()-1000,amount:24,anonymous:true,personaId:'private-id',name:'PRIVATE-NAME',text:'<script>alert(1)</script>'});
  const html=render([message]);assert.match(html,/익명의 관객/);assert.match(html,/24P/);assert.match(html,/role="status"/);assert.match(html,/aria-live="polite"/);assert.match(html,/&lt;script&gt;/);assert.doesNotMatch(html,/PRIVATE-NAME|private-id|<script>/);
});

test('deleted, stale and future gifts cannot replay as toasts on reconnect or a new session',()=>{
  const old=donationMessage({id:'old',at:Date.now()-13000,amount:24,text:'OLD-GIFT'}),future=donationMessage({id:'future',at:Date.now()+60000,amount:24,text:'FUTURE-GIFT'});
  assert.doesNotMatch(render([old,future]),/OLD-GIFT|FUTURE-GIFT/);assert.doesNotMatch(render([]),/donation-toast"/);
  assert.doesNotMatch(render([{id:'chat',kind:'chat',time:Date.now(),text:'ordinary'}]),/ordinary/);
});

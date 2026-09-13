import test from 'node:test';
import assert from 'node:assert/strict';
import {EventEmitter} from 'node:events';
import {PassThrough} from 'node:stream';
import {existsSync,readFileSync} from 'node:fs';
import {CodexProvider} from '../server/codex-provider.js';
import {Settings} from '../server/schema.js';
import {defaults} from '../shared/defaults.js';
test('Codex cancellation waits for child close before deleting frame directory',async()=>{
  let closed=false,dir;const controller=new AbortController();
  const p=new CodexProvider({},(_bin,args,options)=>{
    dir=options.cwd;assert.ok(existsSync(dir));assert.ok(args.includes('--ephemeral'));assert.ok(args.includes('read-only'));
    assert.ok(args.includes('skills.max_context_tokens=1'));
    const override=args.find(a=>a.startsWith('model_instructions_file='));assert.ok(override);const path=JSON.parse(override.split('=').slice(1).join('='));assert.match(readFileSync(path,'utf8'),/AI 관객 연출자/);assert.ok(args.includes('--ignore-user-config'));assert.ok(args.includes('shell_tool'));
    const child=new EventEmitter();child.stdin=new PassThrough();child.stdout=new PassThrough();child.stderr=new PassThrough();
    child.kill=()=>{setTimeout(()=>{closed=true;child.emit('close',1);},25);return true;};
    setTimeout(()=>controller.abort(),10);return child;
  });p.available=true;
  await assert.rejects(p.react({settings:Settings.parse(defaults),history:[],speech:'test',image:'data:image/jpeg;base64,eA=='},controller.signal),/취소/);
  assert.equal(closed,true);assert.equal(existsSync(dir),false);
});

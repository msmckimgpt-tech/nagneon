import test from 'node:test';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
import {resolve} from 'node:path';
const {profileDirectory}=createRequire(import.meta.url)('../desktop/runtime.cjs');
test('both current and legacy launchers resolve the same isolated profile without changing it',()=>{
 const profile=resolve('artifacts/profile with spaces');
 assert.equal(profileDirectory(['--nagneon-profile='+profile]),profile);
 assert.equal(profileDirectory(['--backseat-profile='+profile]),profile);
 assert.equal(profileDirectory(['--other=value']),null);
 for(const flag of ['--nagneon-profile=','--backseat-profile='])assert.throws(()=>profileDirectory([flag+'relative']),/절대 경로/);
});

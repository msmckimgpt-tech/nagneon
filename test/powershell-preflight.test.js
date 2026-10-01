import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, readdir } from 'node:fs/promises';
import { join } from 'node:path';
import {
  preflightPowerShellRuntime,
  readPowerShellPolicy,
} from '../scripts/lib/powershell-runtime.mjs';

const executable = 'C:\\fixture\\pwsh.exe';
const scopes = ['MachinePolicy', 'UserPolicy', 'Process', 'CurrentUser', 'LocalMachine'].map(
  (scope) => ({ scope, policy: scope === 'LocalMachine' ? 'RemoteSigned' : 'Undefined' }),
);
const options = {
  env: { NAGNEON_TEST_POWERSHELL: executable },
  stat: () => ({ isFile: () => true }),
  version: () => '7.6.5',
};

test('preflight records effective policy and all scopes for the selected host', () => {
  const observed = { effective: 'RemoteSigned', scopes };
  const result = preflightPowerShellRuntime({
    ...options,
    policy: (path) => {
      assert.equal(path, executable);
      return observed;
    },
  });
  assert.equal(result.executable, executable);
  assert.deepEqual(result.policy, observed);
});

test('Restricted stops before file execution and preserves scope diagnostics', () => {
  assert.throws(
    () =>
      preflightPowerShellRuntime({
        ...options,
        policy: () => ({ effective: 'Restricted', scopes }),
      }),
    (error) =>
      /Restricted/.test(error.message) &&
      error.message.includes(executable) &&
      /MachinePolicy/.test(error.message),
  );
});

test('policy-query access refusal preserves EACCES without another attempt', () => {
  let calls = 0;
  assert.throws(
    () =>
      readPowerShellPolicy(executable, (path, args) => {
        calls++;
        assert.equal(path, executable);
        assert.ok(args.includes('-Command'));
        const error = new Error('fixture denied');
        error.code = 'EACCES';
        return { error, status: null };
      }),
    (error) => error.code === 'EACCES' && error.executable === executable,
  );
  assert.equal(calls, 1);
});

test('nonzero and malformed policy results fail closed', () => {
  assert.throws(
    () => readPowerShellPolicy(executable, () => ({ status: 1, stderr: 'fixture rejection' })),
    /fixture rejection/,
  );
  assert.throws(() =>
    readPowerShellPolicy(executable, () => ({ status: 0, stdout: 'invalid-json' })),
  );
  for (const observed of [
    { effective: 'Undefined', scopes },
    { effective: 'RemoteSigned', scopes: [] },
  ])
    assert.throws(
      () => preflightPowerShellRuntime({ ...options, policy: () => observed }),
      /유효하지/,
    );
});

test('verification invocations and child helpers contain no policy override', async () => {
  const paths = [];
  async function walk(dir) {
    for (const entry of await readdir(dir, { withFileTypes: true })) {
      const path = join(dir, entry.name);
      if (entry.isDirectory() && entry.name !== '__pycache__') await walk(path);
      else if (/\.(mjs|js|py|ps1|cmd|bat)$/i.test(entry.name)) paths.push(path);
    }
  }
  await walk('scripts');
  paths.push('test/profile-compatibility.test.js', 'test/release-shortcuts.test.js');
  for (const path of paths)
    assert.doesNotMatch(
      await readFile(path, 'utf8'),
      /(?<![\w])-ExecutionPolicy\b|Set-ExecutionPolicy\b|Unblock-File\b/i,
      path,
    );
});

import test from 'node:test';
import assert from 'node:assert/strict';
import {
  selectPowerShellRuntime,
  readPowerShellVersion,
} from '../scripts/lib/powershell-runtime.mjs';

const env = {
  ProgramFiles: 'C:\\Program Files',
  LOCALAPPDATA: 'C:\\Users\\synthetic\\AppData\\Local',
  SystemRoot: 'C:\\Windows',
};
const standard = 'C:\\Program Files\\PowerShell\\7\\pwsh.exe';
const store = 'C:\\Users\\synthetic\\AppData\\Local\\Microsoft\\WindowsApps\\pwsh.exe';
const legacy = 'C:\\Windows\\System32\\WindowsPowerShell\\v1.0\\powershell.exe';
const file = { isFile: () => true };
const fail = (code) => {
  const e = new Error(code);
  e.code = code;
  throw e;
};

test('an accessible standard PowerShell 7 is selected and version queried once', () => {
  const calls = [];
  const r = selectPowerShellRuntime({
    env,
    stat: (p) => {
      calls.push(p);
      return file;
    },
    version: () => '7.6.5',
  });
  assert.deepEqual(r, { executable: standard, version: '7.6.5', source: 'standard' });
  assert.deepEqual(calls, [standard]);
});
test('only a genuinely absent standard host permits store selection', () => {
  const r = selectPowerShellRuntime({
    env,
    stat: (p) => (p === standard ? fail('ENOENT') : file),
    version: () => '7.6.5',
  });
  assert.equal(r.executable, store);
});
for (const code of ['EACCES', 'EPERM'])
  test(`a denied store alias preserves ${code} and never selects legacy`, () => {
    const calls = [];
    assert.throws(
      () =>
        selectPowerShellRuntime({
          env,
          stat: (p) => {
            calls.push(p);
            return p === standard ? fail('ENOENT') : fail(code);
          },
          version: () => assert.fail('A denied candidate cannot be executed'),
        }),
      (e) => e.code === code && e.executable === store,
    );
    assert.deepEqual(calls, [standard, store]);
  });
test('genuinely absent PowerShell 7 candidates permit supported Windows PowerShell 5.1', () => {
  const r = selectPowerShellRuntime({
    env,
    stat: (p) => (p === legacy ? file : fail('ENOENT')),
    version: () => '5.1.26100.9444',
  });
  assert.deepEqual(r, { executable: legacy, version: '5.1.26100.9444', source: 'legacy' });
});
test('an explicit existing host is validated directly without inspecting denied aliases', () => {
  const configured = 'C:\\trusted-host\\pwsh.exe',
    calls = [];
  const r = selectPowerShellRuntime({
    env: { ...env, NAGNEON_TEST_POWERSHELL: configured },
    stat: (p) => {
      calls.push(p);
      return file;
    },
    version: () => '7.6.5',
  });
  assert.equal(r.source, 'configured-test-host');
  assert.deepEqual(calls, [configured]);
});
for (const code of ['ENOENT', 'EACCES'])
  test(`an explicit ${code} host fails without any fallback`, () => {
    let calls = 0;
    assert.throws(
      () =>
        selectPowerShellRuntime({
          env: { ...env, NAGNEON_TEST_POWERSHELL: standard },
          stat: () => {
            calls++;
            return fail(code);
          },
          version: () => assert.fail(),
        }),
      (e) => e.code === code,
    );
    assert.equal(calls, 1);
  });
test('relative and unexpected executable configuration is refused before probing', () => {
  for (const path of ['pwsh.exe', '.\\pwsh.exe', 'C:\\host\\cmd.exe'])
    assert.throws(
      () =>
        selectPowerShellRuntime({
          env: { ...env, NAGNEON_TEST_POWERSHELL: path },
          stat: () => assert.fail(),
        }),
      /절대 경로/,
    );
});
test('unsupported versions and version-query failures never inspect a second host', () => {
  for (const version of [() => '6.2.0', () => 'not-a-version', () => fail('EACCES')]) {
    const calls = [];
    assert.throws(() =>
      selectPowerShellRuntime({
        env,
        stat: (p) => {
          calls.push(p);
          return file;
        },
        version,
      }),
    );
    assert.deepEqual(calls, [standard]);
  }
});
test('an existing directory cannot masquerade as a PowerShell executable', () => {
  assert.throws(
    () =>
      selectPowerShellRuntime({
        env,
        stat: () => ({ isFile: () => false }),
        version: () => assert.fail(),
      }),
    /일반 실행 파일/,
  );
});
test('all absent candidates produce an actionable configured-host error', () => {
  assert.throws(
    () =>
      selectPowerShellRuntime({ env, stat: () => fail('ENOENT'), version: () => assert.fail() }),
    /NAGNEON_TEST_POWERSHELL/,
  );
});
test(
  'an explicitly supplied real test host reports its own supported version',
  {
    skip: !process.env.NAGNEON_TEST_POWERSHELL,
  },
  () => {
    const r = selectPowerShellRuntime();
    assert.equal(r.source, 'configured-test-host');
    assert.equal(readPowerShellVersion(r.executable), r.version);
  },
);

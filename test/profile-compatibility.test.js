import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, writeFile, readFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { spawnSync } from 'node:child_process';

test(
  'Windows launcher compatibility rejects newer records without modifying them',
  { skip: process.platform !== 'win32' },
  async () => {
    await mkdir('artifacts', { recursive: true });
    const profile = await mkdtemp(resolve('artifacts/profile-compatibility-'));
    await mkdir(join(profile, 'data'));
    const runner = join(profile, 'check.ps1'),
      world = join(profile, 'data/world.json');
    await writeFile(
      runner,
      `param([string]$Helper,[string]$Profile,[string]$AppVersion)\n$ErrorActionPreference='Stop'\n. $Helper\nAssert-NagneonProfileCompatibility -Profile $Profile -AppVersion $AppVersion\n`,
    );
    const invoke = (version) =>
      spawnSync(
        'powershell.exe',
        [
          '-NoProfile',
          '-ExecutionPolicy',
          'Bypass',
          '-File',
          runner,
          '-Helper',
          resolve('scripts/Profile-Compatibility.ps1'),
          '-Profile',
          profile,
          '-AppVersion',
          version,
        ],
        { encoding: 'utf8', windowsHide: true },
      );
    const legacy = {
      settings: { title: '방송 기록과 추억', maxCalls: 120, personas: [{ id: 'fixture' }] },
    };
    await writeFile(world, JSON.stringify(legacy));
    assert.equal(invoke('0.1.3').status, 0);
    for (const data of [
      { settings: { personas: [] } },
      {
        settings: {
          maxCalls: 120,
          personas: Array.from({ length: 41 }, (_, i) => ({ id: String(i) })),
        },
      },
    ]) {
      const raw = JSON.stringify(data);
      await writeFile(world, raw);
      const old = invoke('0.1.3');
      assert.notEqual(old.status, 0);
      assert.match(old.stderr, /0\.1\.4 or later/);
      assert.equal(await readFile(world, 'utf8'), raw);
      assert.equal(invoke('0.1.4').status, 0);
      assert.equal(invoke('0.2.0').status, 0);
    }
    await writeFile(world, 'broken');
    assert.notEqual(invoke('0.1.3').status, 0);
    assert.equal(await readFile(world, 'utf8'), 'broken');
    assert.notEqual(invoke('unknown').status, 0);
  },
);

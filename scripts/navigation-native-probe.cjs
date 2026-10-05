// A verifier-owned PowerShell process dispatches only the supplied test windows.
// Reuse its compiled P/Invoke declaration without relaxing the input deadline.
const { spawn } = require('node:child_process');
const { join } = require('node:path');
const assert = require('node:assert/strict');

function createNativeNavigationProbe() {
  let child,
    ready,
    failure,
    identity,
    closed = false,
    stderr = '',
    buffer = '';
  const lines = [],
    waiters = [];
  function nextLine(timeout) {
    if (lines.length) return Promise.resolve(lines.shift());
    if (failure) return Promise.reject(failure);
    return new Promise((resolve, reject) => {
      const waiter = { resolve, reject };
      waiter.timer = setTimeout(() => {
        const index = waiters.indexOf(waiter);
        if (index >= 0) waiters.splice(index, 1);
        reject(new Error('Native navigation input timed out: ' + stderr));
      }, timeout);
      waiters.push(waiter);
    });
  }
  function failed(error) {
    failure = error;
    for (const waiter of waiters.splice(0)) {
      clearTimeout(waiter.timer);
      waiter.reject(error);
    }
  }
  function start() {
    const script = `
Add-Type -TypeDefinition 'using System; using System.Runtime.InteropServices; public class NativeNavigationProbe { [DllImport("user32.dll", SetLastError=true)] public static extern bool PostMessage(IntPtr h, uint m, IntPtr w, IntPtr l); }'
if (-not $?) { exit 1 }
[Console]::Out.WriteLine('ready')
while ($null -ne ($line = [Console]::In.ReadLine())) {
  $parts = $line.Split(' ')
  $handle = [IntPtr]([long]$parts[0])
  $command = [IntPtr]([long]$parts[1])
  if ([NativeNavigationProbe]::PostMessage($handle, 0x0319, $handle, $command)) {
    [Console]::Out.WriteLine('ok')
  } else { [Console]::Out.WriteLine('failed') }
}
`;
    const executable =
      process.env.NAGNEON_TEST_POWERSHELL ||
      join(process.env.SystemRoot, 'System32', 'WindowsPowerShell', 'v1.0', 'powershell.exe');
    child = spawn(executable, ['-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true,
      stdio: ['pipe', 'pipe', 'pipe'],
    });
    identity = { pid: child.pid, startedAt: Date.now(), executable };
    child.stdin.on('error', failed);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      buffer += chunk;
      while (buffer.includes('\n')) {
        const end = buffer.indexOf('\n'),
          line = buffer.slice(0, end).trim();
        buffer = buffer.slice(end + 1);
        const waiter = waiters.shift();
        if (waiter) {
          clearTimeout(waiter.timer);
          waiter.resolve(line);
        } else lines.push(line);
      }
    });
    child.stderr.on('data', (chunk) => {
      stderr = (stderr + chunk).slice(-2048);
    });
    child.on('error', failed);
    child.on('close', (code) => {
      closed = true;
      failed(new Error('Native navigation dispatcher exited: ' + code + ' ' + stderr));
    });
    ready = nextLine(15000).then((line) => assert.equal(line, 'ready', stderr));
  }
  return {
    async post(win, command) {
      assert.equal(process.platform, 'win32');
      assert.ok(!win.isDestroyed());
      assert.ok(command === 1 || command === 2);
      const deadline = Date.now() + 15000;
      if (!child) start();
      await ready;
      const handle = win.getNativeWindowHandle();
      const hwnd =
        handle.length === 8 ? handle.readBigUInt64LE().toString() : String(handle.readUInt32LE());
      child.stdin.write(hwnd + ' ' + command * 65536 + '\n');
      assert.equal(await nextLine(Math.max(1, deadline - Date.now())), 'ok', stderr);
    },
    async close() {
      if (!child || closed) return;
      await new Promise((resolve) => {
        const timer = setTimeout(() => {
          if (!closed && child.pid && child.exitCode === null) {
            assert.equal(child.pid, identity.pid);
            assert.equal(child.spawnfile, identity.executable);
            child.kill();
          }
        }, 3000);
        child.once('close', () => {
          clearTimeout(timer);
          resolve();
        });
        child.stdin?.end();
      });
    },
  };
}
module.exports = { createNativeNavigationProbe };

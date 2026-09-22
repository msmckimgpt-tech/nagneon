"""Temporary-root refusal tests. No running agent or credentials are touched."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest

SCRIPT = Path(__file__).parent / 'launchers/repair-rdc.ps1'


@unittest.skipUnless(os.name == 'nt', 'Windows recovery script')
class RecoveryTests(unittest.TestCase):
    def test_reused_pid_is_not_stopped(self):
        with tempfile.TemporaryDirectory() as temp:
            root = Path(temp)
            entry = root / 'tools/desktop-commander/node_modules/@wonderwhy-er/desktop-commander/dist/index.js'
            entry.parent.mkdir(parents=True)
            entry.write_text('// fixture')
            (root / 'bin').mkdir()
            for name in ['start-rdc.ps1', 'stop-rdc.ps1']:
                (root / 'bin' / name).write_text("throw 'Launcher must never execute'")
            record = {'pid': os.getpid(), 'started': '2000-01-01T00:00:00Z',
                      'entry': str(entry), 'executable': 'unrelated.exe'}
            (root / 'rdc-process.json').write_text(json.dumps(record))
            before = (root / 'rdc-process.json').read_bytes()
            result = subprocess.run(['pwsh.exe', '-NoProfile', '-File', str(SCRIPT),
                                     '-Root', str(root), '-RestartOwned'], capture_output=True, timeout=20)
            self.assertNotEqual(result.returncode, 0)
            self.assertIn(b'different process', result.stderr)
            self.assertEqual(before, (root / 'rdc-process.json').read_bytes())

    def test_missing_install_does_not_create_or_download(self):
        with tempfile.TemporaryDirectory() as temp:
            result = subprocess.run(['pwsh.exe', '-NoProfile', '-File', str(SCRIPT),
                                     '-Root', temp], capture_output=True, timeout=20)
            self.assertNotEqual(result.returncode, 0)
            self.assertEqual(list(Path(temp).iterdir()), [])


if __name__ == '__main__':
    unittest.main()

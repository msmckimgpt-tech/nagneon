"""Temporary-home installation checks; never touches real global configuration."""
import json
import os
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

INSTALLER = Path(__file__).parent / 'install.py'
BEGIN = b'<!-- BEGIN WEB-DEVELOPMENT-COMPANION -->'
END = b'<!-- END WEB-DEVELOPMENT-COMPANION -->'


class InstallTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.base = Path(self.temp.name)
        self.home = self.base / 'home with spaces'
        self.home.mkdir()
        self.docs = [self.home / '.codex/AGENTS.md', self.home / '.claude/CLAUDE.md']
        self.prefix = b'Existing global instructions\r\n\r\n'
        self.suffix = b'\r\n\r\nUnrelated instructions preserved\r\n'
        for doc in self.docs:
            doc.parent.mkdir(parents=True)
            doc.write_bytes(self.prefix + BEGIN + b'\r\nold block\r\n' + END + self.suffix)

    def run_install(self, *args, expected=0):
        result = subprocess.run([sys.executable, str(INSTALLER), '--home', str(self.home), *args],
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, expected, result.stderr)
        return json.loads(result.stdout) if result.stdout.strip() else result.stderr

    def test_install_preserves_docs_and_is_idempotent(self):
        initial = {str(p): p.read_bytes() for p in self.docs}
        self.assertGreater(self.run_install()['changed'], 0)
        for doc in self.docs:
            data = doc.read_bytes()
            self.assertEqual(data[:data.index(BEGIN)], self.prefix)
            self.assertEqual(data[data.index(END) + len(END):], self.suffix)
            self.assertEqual(data.count(BEGIN), 1)
        before = {str(p): (p.read_bytes(), p.stat().st_mtime_ns)
                  for p in self.home.rglob('*') if p.is_file()}
        self.assertTrue(self.run_install('--check')['up_to_date'])
        self.assertEqual(self.run_install()['changed'], 0)
        after = {str(p): (p.read_bytes(), p.stat().st_mtime_ns)
                 for p in self.home.rglob('*') if p.is_file()}
        self.assertEqual(before, after)
        backups = list((self.home / '.local/share/ai-web-development/backups').glob('*/*.before'))
        for content in initial.values():
            self.assertIn(content, [p.read_bytes() for p in backups])

    def test_existing_official_policy_replaced_and_outside_preserved(self):
        begin = b'<!-- BEGIN OFFICIAL-CHAT-DELEGATION -->'
        end = b'<!-- END OFFICIAL-CHAT-DELEGATION -->'
        for doc in self.docs:
            doc.write_bytes(doc.read_bytes() + begin + b'old delegate everything' + end + b'\nTAIL')
        self.run_install()
        for doc in self.docs:
            data = doc.read_bytes()
            self.assertNotIn(b'old delegate everything', data)
            self.assertIn(self.suffix, data)
            self.assertTrue(data.endswith(b'\nTAIL'))
            self.assertEqual(data.count(begin), 1)
        self.assertTrue(self.run_install('--check')['up_to_date'])

    def test_malformed_official_policy_rejected_before_mutation(self):
        self.docs[0].write_bytes(self.docs[0].read_bytes() + b'<!-- BEGIN OFFICIAL-CHAT-DELEGATION -->')
        before = {str(p): p.read_bytes() for p in self.home.rglob('*') if p.is_file()}
        self.run_install(expected=2)
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.home.rglob('*') if p.is_file()})

    def test_check_is_read_only(self):
        before = {str(p): p.read_bytes() for p in self.home.rglob('*') if p.is_file()}
        self.assertFalse(self.run_install('--check', expected=1)['up_to_date'])
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.home.rglob('*') if p.is_file()})

    def test_unmanaged_collision_fails_before_doc_changes(self):
        collision = self.home / '.agents/skills/web-development/SKILL.md'
        collision.parent.mkdir(parents=True)
        collision.write_text('Existing unrelated skill', encoding='utf-8')
        before = {str(p): p.read_bytes() for p in self.home.rglob('*') if p.is_file()}
        self.assertIn('Unmanaged', self.run_install(expected=2))
        self.assertEqual(before, {str(p): p.read_bytes() for p in self.home.rglob('*') if p.is_file()})

    def test_local_installed_edits_preserved(self):
        self.run_install()
        skill = self.home / '.agents/skills/web-development/SKILL.md'
        skill.write_text('User modification', encoding='utf-8')
        self.assertIn('locally modified', self.run_install(expected=2))
        self.assertEqual(skill.read_text(), 'User modification')

    def test_malformed_block_rejected(self):
        self.docs[0].write_bytes(END + b'\n' + BEGIN)
        self.assertIn('Malformed', self.run_install(expected=2))

    def test_installed_wrapper_executes_helper(self):
        self.run_install()
        if os.name == 'nt':
            wrapper = self.home / '.local/share/ai-web-development/bin/web-development.ps1'
            command = ['powershell', '-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', str(wrapper), '--help']
        else:
            command = [str(self.home / '.local/bin/web-development'), '--help']
        env = dict(os.environ, HOME=str(self.home))
        result = subprocess.run(command, env=env, capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertIn('import-synthesis', result.stdout)

    def test_backup_directory_symlink_rejected_before_writes(self):
        outside = self.base / 'outside'
        outside.mkdir()
        backups = self.home / '.local/share/ai-web-development/backups'
        backups.parent.mkdir(parents=True)
        try:
            backups.symlink_to(outside, target_is_directory=True)
        except OSError:
            self.skipTest('OS does not grant symlink creation')
        self.run_install(expected=2)
        self.assertEqual(list(outside.iterdir()), [])

    @unittest.skipUnless(os.name == 'nt', 'Windows PowerShell parser check')
    def test_powershell_launchers_parse_without_executing(self):
        env = dict(os.environ, WEB_DEVELOPMENT_TEST_LAUNCHERS=str(INSTALLER.parent / 'launchers'))
        script = ("$count=0; Get-ChildItem -LiteralPath $env:WEB_DEVELOPMENT_TEST_LAUNCHERS -Filter '*.ps1' | "
                  "ForEach-Object { $tokens=$null; $errors=$null; "
                  "[System.Management.Automation.Language.Parser]::ParseFile($_.FullName,[ref]$tokens,[ref]$errors) | Out-Null; "
                  "if($errors.Count){$errors | Out-String | Write-Error; exit 1}; $count++ }; "
                  "if($count -ne 5){exit 2}")
        result = subprocess.run(['powershell', '-NoProfile', '-Command', script], env=env,
                                capture_output=True, text=True, timeout=30)
        self.assertEqual(result.returncode, 0, result.stderr)


if __name__ == '__main__':
    unittest.main()

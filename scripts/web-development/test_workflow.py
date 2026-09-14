"""Executable handoff gate tests; no browser, network or model is involved."""
import contextlib
import importlib.util
import io
import json
from pathlib import Path
import subprocess
import sys
import tempfile
import unittest

MODULE = Path(__file__).parent / 'skill' / 'scripts' / 'workflow.py'
sys.dont_write_bytecode = True
spec = importlib.util.spec_from_file_location('workflow', MODULE)
workflow = importlib.util.module_from_spec(spec)
spec.loader.exec_module(workflow)


class WorkflowTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.repo = self.root / 'repo'
        self.repo.mkdir()
        self.run = self.root / 'run'
        (self.repo / 'app.py').write_text('def value():\n    return 42\n', encoding='utf-8')
        self.goal = self.root / 'goal.md'
        self.goal.write_text('Review value correctness and design.', encoding='utf-8')
        self.response = self.root / 'answer.md'
        self.response.write_text('app.py:2 returns 42. Test the required value.', encoding='utf-8')

    def cli(self, *args, success=True):
        stdout, stderr = io.StringIO(), io.StringIO()
        with contextlib.redirect_stdout(stdout), contextlib.redirect_stderr(stderr):
            result = workflow.main([str(a) for a in args])
        self.assertEqual(result, 0 if success else 1, stderr.getvalue())
        return json.loads(stdout.getvalue()) if result == 0 else stderr.getvalue()

    def prepare(self, *extra):
        return self.cli('prepare', '--repo', self.repo, '--goal-file', self.goal,
                        '--out', self.run, '--file', 'app.py', *extra)

    def import_roles(self):
        for role in ('architecture', 'correctness', 'performance'):
            self.cli('import', '--run', self.run, '--role', role,
                     '--file', self.response, '--source', 'https://chatgpt.com/c/test')

    def full_run(self):
        self.prepare()
        self.import_roles()
        self.cli('synthesize', '--run', self.run)
        self.cli('import-synthesis', '--run', self.run, '--file', self.response,
                 '--source', 'https://chatgpt.com/c/synthesis')

    def test_full_workflow_preserves_evidence_and_never_executes_responses(self):
        sentinel = self.root / 'executed'
        payload = f'app.py:2 evidence\nimport pathlib; pathlib.Path({str(sentinel)!r}).touch()\n'
        self.response.write_text(payload, encoding='utf-8')
        self.full_run()
        final = self.cli('finalize', '--run', self.run)
        self.assertFalse(final['applied'])
        self.assertFalse(sentinel.exists())
        self.assertEqual((self.run / 'responses/architecture.md').read_text(), payload)
        prompt = (self.run / 'synthesis-prompt.md').read_text()
        self.assertIn('app.py:2:     return 42', prompt)
        for role in ('architecture', 'correctness', 'performance'):
            self.assertIn('Unverified supplied response: ' + role, prompt)
        status = self.cli('status', '--run', self.run)
        self.assertEqual(status['stage'], 'local-review-required')
        self.assertFalse(status['remote_completion_verified'])

    def test_missing_roles_and_synthesis_fail(self):
        self.prepare()
        self.cli('synthesize', '--run', self.run, success=False)
        self.cli('finalize', '--run', self.run, success=False)
        self.cli('import-synthesis', '--run', self.run, '--file', self.response,
                 '--source', 'https://example.org/review', success=False)
        self.assertEqual(len(self.cli('status', '--run', self.run)['roles_missing']), 3)

    def test_stale_source_fails_status_and_finalize(self):
        self.full_run()
        (self.repo / 'app.py').write_text('changed\n')
        self.assertIn('Stale source', self.cli('finalize', '--run', self.run, success=False))
        self.cli('status', '--run', self.run, success=False)

    def test_real_git_head_change_detected(self):
        def git(*args):
            subprocess.run(['git', '-C', str(self.repo), *args], check=True,
                           capture_output=True)
        git('init')
        git('add', 'app.py')
        git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
            'commit', '-m', 'baseline')
        self.prepare()
        git('-c', 'user.name=Test', '-c', 'user.email=test@example.invalid',
            'commit', '--allow-empty', '-m', 'advance')
        self.assertIn('HEAD', self.cli('status', '--run', self.run, success=False))

    def test_tampered_snapshot_and_manifest_fail(self):
        self.prepare()
        snapshot = self.run / 'sources/app.py'
        original = snapshot.read_bytes()
        snapshot.write_text('tampered')
        self.cli('status', '--run', self.run, success=False)
        snapshot.write_bytes(original)
        (self.run / 'manifest.json').write_text('{}')
        self.cli('status', '--run', self.run, success=False)

    def test_tampered_response_and_missing_raw_fail(self):
        self.prepare()
        self.import_roles()
        response = self.run / 'responses/architecture.md'
        response.write_text('tampered')
        self.cli('synthesize', '--run', self.run, success=False)
        response.unlink()
        self.cli('status', '--run', self.run, success=False)

    def test_tampered_synthesis_and_final_report_fail(self):
        self.full_run()
        self.cli('finalize', '--run', self.run)
        (self.run / 'local-final-review.md').write_text('tampered')
        self.cli('status', '--run', self.run, success=False)
        (self.run / 'synthesis.md').write_text('tampered')
        self.cli('finalize', '--run', self.run, success=False)

    def test_missing_generated_prompt_is_corruption(self):
        self.full_run()
        (self.run / 'synthesis-prompt.md').unlink()
        self.cli('status', '--run', self.run, success=False)

    def test_entire_role_response_removed_after_synthesis_fails_status(self):
        self.full_run()
        for suffix in ('.md', '.md.sha256', '.json', '.json.sha256'):
            (self.run / ('responses/architecture' + suffix)).unlink()
        self.assertIn('Missing role response', self.cli('status', '--run', self.run, success=False))

    def test_entire_synthesis_removed_after_finalize_fails_status(self):
        self.full_run()
        self.cli('finalize', '--run', self.run)
        for suffix in ('.md', '.md.sha256', '.json', '.json.sha256'):
            (self.run / ('synthesis' + suffix)).unlink()
        self.cli('status', '--run', self.run, success=False)

    def test_entire_prompt_removed_after_synthesis_fails_status(self):
        self.full_run()
        for suffix in ('', '.sha256'):
            (self.run / ('synthesis-prompt.md' + suffix)).unlink()
        self.cli('status', '--run', self.run, success=False)

    def test_path_escapes_secret_paths_and_directories_fail(self):
        (self.repo / '.env').write_text('secret')
        (self.repo / 'auth.json').write_text('{}')
        for name in ('../goal.md', '/tmp/file', 'C:/secret', '..\\goal.md',
                     '.env', 'auth.json', '.'):
            with self.subTest(name=name):
                self.cli('prepare', '--repo', self.repo, '--goal-file', self.goal,
                         '--out', self.run, '--file', name, success=False)
        self.assertFalse(self.run.exists())

    def test_symlink_selection_and_artifact_escape_fail(self):
        link = self.repo / 'linked.py'
        try:
            link.symlink_to(self.repo / 'app.py')
        except OSError:
            self.skipTest('OS does not grant symlink creation')
        self.cli('prepare', '--repo', self.repo, '--goal-file', self.goal,
                 '--out', self.run, '--file', 'linked.py', success=False)
        self.prepare()
        target = self.run / 'snapshot.md'
        target.unlink()
        target.symlink_to(self.goal)
        self.cli('status', '--run', self.run, success=False)

    def test_overwrite_unknown_role_and_empty_response_fail(self):
        self.prepare()
        self.cli('prepare', '--repo', self.repo, '--goal-file', self.goal,
                 '--out', self.run, '--file', 'app.py', success=False)
        self.import_roles()
        for role in ('architecture', '../escape'):
            self.cli('import', '--run', self.run, '--role', role, '--file', self.response,
                     '--source', 'https://example.org', success=False)
        self.response.write_text(' \n')
        self.cli('synthesize', '--run', self.run)
        self.cli('import-synthesis', '--run', self.run, '--file', self.response,
                 '--source', 'https://example.org', success=False)

    def test_binary_and_oversized_sources_fail(self):
        for content in (b'\x00binary', b'x' * (workflow.LIMIT + 1)):
            (self.repo / 'app.py').write_bytes(content)
            self.cli('prepare', '--repo', self.repo, '--goal-file', self.goal,
                     '--out', self.run, '--file', 'app.py', success=False)


if __name__ == '__main__':
    unittest.main()

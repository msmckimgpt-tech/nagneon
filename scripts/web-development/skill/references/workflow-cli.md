# Offline handoff helper

Run `python <skill>/scripts/workflow.py --help` for the installed interface. Commands
take literal argument paths, not shell fragments. Use a new output directory per task.

```text
python workflow.py prepare --repo /absolute/repo --goal-file /absolute/goal.txt --file src/example.ts --file test/example.test.ts --roles architecture,correctness,performance --out /absolute/new-run
python workflow.py import --run /absolute/new-run --role architecture --file /absolute/architecture-response.md --source https://chatgpt.com/c/ACTUAL-CONVERSATION-ID
python workflow.py import --run /absolute/new-run --role correctness --file /absolute/correctness-response.md --source https://chatgpt.com/c/ACTUAL-CONVERSATION-ID
python workflow.py import --run /absolute/new-run --role performance --file /absolute/performance-response.md --source https://chatgpt.com/c/ACTUAL-CONVERSATION-ID
python workflow.py synthesize --run /absolute/new-run
python workflow.py import-synthesis --run /absolute/new-run --file /absolute/web-synthesis.md --source https://chatgpt.com/c/ACTUAL-SYNTHESIS-ID
python workflow.py finalize --run /absolute/new-run
python workflow.py status --run /absolute/new-run
```

Replace the example paths and conversation IDs. Import every configured role before
synthesis. Send the generated synthesis prompt to the web, then import the actual
answer. `finalize` only prepares local review; it does not approve the proposal,
execute tests, apply patches, commit, or push.

In PowerShell quote the role list, e.g. `--roles 'architecture,correctness,performance'`,
so commas are passed as one argument. The Windows wrapper is
`~/.local/share/ai-web-development/bin/web-development.ps1`; on WSL use
`~/.local/bin/web-development` or the Python helper directly.

The original selected source paths and baseline commit must still match. A final
review packet becomes stale if code subsequently changes. Recheck at integration.
For non-Git tasks file hashes are the baseline. Secret filename checks are a useful
guard, not content scanning: inspect selected content before sending it externally.

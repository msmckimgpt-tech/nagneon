---
name: web-development
description: Use web models as a supplementary development path for parallel design, debugging, reviews or isolated implementation, synthesize the web results, then verify and integrate locally. Supports 웹쫀쿠 and Remote Desktop Commander handoffs.
---

# Web development companion

Use this route when multiple independent perspectives, a difficult design decision,
or a bounded implementation task merits web assistance. Keep small edits and rapid
edit/test loops local. The user has requested this global supplementary workflow;
do not require them to repeat that preference. Preserve the selected models,
existing local providers and project quality gates. For delegated web work the user
explicitly requests **xhigh**, even when slow. Apply it to every independent role,
web implementation and synthesis. In Codex Web GPT use `chatgpt-web/extra-high`
with `model_reasoning_effort="xhigh"`; in browser UI verify Extra High before sending.
Do not silently fall back to high/medium/Instant when unavailable or taking longer.
Report an unavailable xhigh option and keep dependent work pending. An explicit
later user override takes precedence. Local session model/effort stays unchanged.

## Route by actual capability

- **Local Codex / Claude:** reproduce, select evidence, prepare worktrees, inspect
  returned changes, test and integrate. Local tools already available need no RDC hop.
- **Web model:** independent architecture, correctness, security, performance or UX
  review as relevant, or implementation within an explicitly assigned worktree.
- **Existing browser tools:** when the user is already signed into the chosen web
  client, separate browser conversations can run the same review/synthesis flow.
  Verify each visible completed answer and preserve its conversation URL. This
  does not prove the standalone Web GPT launcher or RDC is authenticated.
- **웹쫀쿠 (Codex Web GPT):** optional web-model transport. Use an installed, signed-in
  launcher and an explicitly selected web model. Never change the normal default
  provider globally merely to run a supplementary task.
- **Remote Desktop Commander (RDC):** web client's OAuth connection to this machine's
  files/terminal. It is not the parallel scheduler. Use exact device identity and
  task paths; no need for a second relay when the web model already has the same
  task's verified tool harness.

Read [connections.md](references/connections.md) to check installation, connect a
web account, or choose transport. Missing login, tool access or quota means report
the specific unavailable stage; never label a local substitute as a web run.

## Web parallel work -> web Best way -> local final review

1. Capture the goal, acceptance criteria, constraints, baseline commit and explicit
   relevant source files. Use `scripts/workflow.py prepare` (Python 3.10+) to create
   a task bundle. It reads only selected text files; it never uploads anything.
   Review the bundle before transmission. Exclude personal records, credentials,
   environment files and irrelevant repository history. For large evidence use
   bounded relevant extracts with paths to preserved originals.
2. Run independent web conversations for useful roles. Start with 2-3 roles; use
   fewer for simple questions. The installed launcher's documented concurrent-tab
   limit is 5, not a target. Do not split accounts or retry to evade usage limits.
   The user requested parallel web work; dispatch through available web tools or
   their selected web transport, not local subagents relabelled as web reviewers.
3. For **review**, each role gets its prepared prompt and the same source snapshot.
   For **implementation**, first create a separate branch/worktree for each writer,
   give exact ownership paths, baseline, output contract and mandatory tests. Web
   workers may commit their own changes when authorized by project policy; they
   must not merge into the shared target or publish unrelated changes. Record
   branch/commit, diff, commands and original test output as results. Never let two
   web tasks edit the same checkout. RDC directory allowlists are not a shell sandbox.
4. Return each raw answer to the task inbox via RDC file tools, bridge output or
   manual export. Import with role and actual source conversation HTTP(S) URL.
   Import labels content as supplied, unverified material: it does not prove that
   the remote work occurred. Verify visible completion or tool receipts separately.
5. `synthesize` requires all requested roles. Send the resulting prompt to a
   separate **web synthesis conversation**. Ask it to reconcile contradictions,
   compare alternatives, select a Best way, explain rejected options and identify
   unresolved risks and required local checks. A synthesis is a proposal, not a
   passed test. Retain all raw role results, even when the synthesis omits one.
6. Import the web synthesis, then `finalize`. The helper checks baseline/file drift
   and artifact hashes and prepares a local review packet. On drift, reassess and
   regenerate affected work; don't apply a stale plan. Locally inspect findings
   against source, check proposed patches/commits, integrate in an isolated worktree,
   run required checks, then follow existing integration-lock/commit/push rules.

For long work, retain pending stage and artifact paths in the relevant project
handoff. A chat ending is not a scheduled continuation: use a supported automation
only when follow-up was requested. Do not promise automatic return polling otherwise.

## Portable helper

See [workflow-cli.md](references/workflow-cli.md) for exact commands. Resolve paths
relative to this skill; on Windows use an installed Python executable and on WSL
use `python3`. Tools never execute returned commands or patches. SHA-256 catches
accidental changes, not an attacker able to rewrite both files and their manifest.

Keep outcome states separate: installed, authenticated, web roles completed,
web synthesis completed, local verification passed, and integrated/published.
Report missing usage as NOT_MEASURED; quota shifting is not proof of token savings.

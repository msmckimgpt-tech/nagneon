# Connections

## Windows installation

Provisioned for this user under `~/.local/share/ai-web-development/`:

- `bin/web-development.ps1`: portable bundle/import/synthesis/final review helper.
- `bin/start-web-gpt.ps1`: open the installed Codex Web GPT launcher.
- `bin/start-web-codex.ps1`: interactive Codex with the supplementary CODEX_HOME.
- `bin/start-rdc.ps1`: start the pinned RDC device agent for pairing/connection.
- `bin/stop-rdc.ps1`: stop only the PID/start-time recorded by this launcher.
- `tools/desktop-commander`: pinned npm installation, separate from product dependencies.
- `runs` / `inbox`: local task artifacts, never part of a public source commit.
- `connection-status.json`: installation/check results. Authentication fields may
  be pending; verify current readiness before routing work.

Installed target versions: Codex Web GPT **5.0.6**, Desktop Commander **0.2.50**.
Check the runtime status; do not assume newer upstream main documentation describes
the installed release. Upgrade only as a separate verified operation.

## Web GPT

Start the launcher and sign in directly in its embedded ChatGPT browser. The
launcher owns a separate browser profile; never copy ChatGPT cookies or Codex
`auth.json` into it. Run its browser smoke test before dispatching real tasks.

Prefer bounded review conversations or the launcher's manual-send mode when it
fits the task. `Zero Risk` is the upstream mode name, not a safety guarantee.
Automatic browser-only supports images but no local tool harness. Full mode adds
an OpenAI tunnel/custom connector; RDC can supply a separate web-to-local channel
without exposing the full Codex harness. Don't configure both without a need.

**Route ownership:** the upstream “Install models” action modifies the target
Codex Responses route. The supplied `start-web-gpt.ps1` launches production mode
with three child-only environment overrides supported in 5.0.6: CODEX_HOME points
to `web-codex-home`, CODEX_CHATGPT_WEB_HOME to `web-bridge`, and
CODEX_WEB_GPT_LAUNCHER_DATA_DIR to `web-launcher`, all under this installation root.
Use this wrapper rather than the default Start-menu shortcut to keep normal
Codex/Claude settings unchanged. Complete login, smoke test and Install models in
that isolated launcher, then use `start-web-codex.ps1`. The isolated Codex may need
its own official `start-web-codex.ps1 -Login`; do not copy existing credentials.
Select a web model explicitly; never change a requested model/effort silently.
Avoid `--dev-profile`: it is an upstream synthetic development harness.

Delegated web work defaults to `chatgpt-web/extra-high` and reasoning `xhigh`,
including synthesis. The start-web-codex wrapper passes both explicitly.
Verify account eligibility before dispatch; never downgrade silently or treat a
prompt asking for deep thinking as proof that the UI/runtime selected xhigh.
The earlier connectivity smoke used `chatgpt-web/high` (High); that historical
check does not establish xhigh availability on every account.
The bare `chatgpt-web` is not a model slug. Use the native `/model` picker for
account-eligible rows; preserve the user's chosen model and effort. An isolated
official Codex login is separate from embedded browser login. After both logins,
`doctor --json` checks the route and proxy; a real Codex response verifies dispatch.
Browser-only emits a local-tools-unavailable notice by design. Use the separately
connected RDC web client for file handoffs; it is not injected into every bridge turn.

Source: https://github.com/miuuyy/codex-chatgpt-web/tree/v5.0.6

## Remote Desktop Commander

Remote MCP endpoint: `https://mcp.desktopcommander.app/mcp` (OAuth).

1. Run `start-rdc.ps1`. The agent prints a device code and verification URL.
2. Sign in to the service; compare the terminal code with the browser code before
   authorizing this machine. Authentication credentials stay with the service.
3. Add the remote MCP in ChatGPT/Claude Web using the endpoint and OAuth. Sign in
   with the same RDC account. Native client registration alone does not connect
   the web client. If account/workspace policies hide custom MCP, report that fact.
4. Verify the selected device, read a nonsensitive task fixture and write a reply
   into that task's inbox. Read it locally and compare contents before declaring
   web-to-local access operational.

The Windows device agent covers Windows files and terminal. For WSL code, use an
explicit `wsl -d Ubuntu-24.04 -- ...` command and Linux worktree paths or separately
install a Linux agent if needed. WSL skills are installed independently; a Windows
device connection does not prove a Linux agent exists.

The agent uses the invoking user's file and shell permissions. `allowedDirectories`
only constrains file tools; it does not confine terminal commands. Exact worktree
ownership is a workflow rule, not OS sandboxing. The hosted relay carries tool
requests/results. Device credentials and tool logs must stay outside review bundles.
Do not add persistent auto-start or a full-machine capability without a concrete
need; use the on-demand launcher, and stop it after remote work is done.

Sources:
- https://github.com/desktop-commander/remote-desktop-commander/blob/main/docs/SETUP.md
- https://github.com/desktop-commander/remote-desktop-commander/blob/main/SECURITY.md

## When a connection is unavailable

Prepare the bundles and finish independent local work. Ask only for the missing
login/connection action and state the exact reason. Do not fabricate remote outputs,
claim dry runs as live acceptance, switch model/effort, bypass a limit, or silently
replace web reviewers with local agents. Manual transmission remains an available
route, clearly labelled as manual. Fully automatic browser transport has additional
service-terms constraints; no CAPTCHA or protective-measure bypass is part of setup.

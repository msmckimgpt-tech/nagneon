# Security policy

## Reporting a vulnerability

Please use [GitHub private vulnerability reporting](https://github.com/msmckimgpt-tech/nagneon/security/advisories/new) to report suspected vulnerabilities. Include the affected commit or version, reproduction steps using synthetic data, and the impact.

Do not publish credentials, login codes, personal recordings, conversation exports, or detailed exploit instructions in public issues. If a credential has been exposed, revoke it with its provider; deleting a file or a commit does not revoke it.

## Scope and safe operation

Nagneon is a local desktop application. Its server is intended to listen only on `127.0.0.1`, with a per-process authentication capability. Do not expose it through port forwarding, a public reverse proxy, or a network-wide listen address.

Official Codex handles ChatGPT authentication. Never commit `auth.json`, API keys, `.env` files, private signing keys, or local application data. `.env.example` contains placeholders only. `data/`, `artifacts/`, models, virtual environments, logs, and release output stay outside source control. Review exports and installation bundles separately before publishing them; Git ignore rules do not protect files already tracked or uploaded as release assets.

This repository currently contains a development snapshot. Security fixes are maintained on the remote `main` branch; historical development builds do not have a separate support commitment. A public repository does not make an unsigned development installer a verified production release.

## Contributor checks

- Review `git diff --cached` before committing and never use `git add -f` to bypass credential exclusions.
- Run `npm audit --audit-level=high` and `npm run check` from an isolated worktree.
- The security workflow scans full Git history with a pinned Gitleaks binary and checks npm advisories. GitHub secret scanning, push protection, and Dependabot provide additional checks; a clean scan is not proof that all vulnerabilities or personal data have been detected.
- Existing author metadata and local path references can remain in Git history. Removing them from the current tree does not erase earlier commits. Coordinate any history rewrite across all worktrees before attempting it.

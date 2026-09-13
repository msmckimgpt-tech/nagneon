# installer/ — NSIS build scaffold

Reviewable, static source for the BACKSEAT Studio **per-user, unsigned
development** Windows installer. This directory contains no per-build data.

**Root review: execution is currently blocked in both init functions (exit 10).**
Extraction, publication rollback, ownership and running-uninstall behavior need
the work listed in `docs/INSTALLER.md` before this becomes a runnable installer.
Compilation and the 13 generator tests do not establish installation acceptance.

| File | Role |
|---|---|
| `common.nsh` | Static macros: identity guard, per-user context, HKCU Add/Remove entry write/delete. No plugins. |
| `strings.nsh` | Korean (primary) + English (fallback) `LangString` UI text. |
| `backseat.nsi.in` | Installer template with `@TOKEN@` placeholders. |

The per-build file lists (`install-files.generated.nsh`,
`uninstall-files.generated.nsh`) and the rendered `backseat.nsi` are produced
by `scripts/build-installer.mjs` from the **verified** package manifest and are
written to an output directory (default under `artifacts/`), not committed
here. That output directory is self-contained: `common.nsh` and `strings.nsh`
are copied next to the rendered `.nsi` so the whole thing compiles from one
folder.

Design, safety model, and the remaining live install/upgrade/uninstall gates
are documented in [`../docs/INSTALLER.md`](../docs/INSTALLER.md).

This is not a signed, retail-ready, or Steam-reviewed installer.

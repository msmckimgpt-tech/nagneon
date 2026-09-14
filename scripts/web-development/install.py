"""Install the web companion for the current user; no account or model changes."""
import argparse
import hashlib
import json
import os
from pathlib import Path
import shutil
import sys
import tempfile
import uuid

SOURCE = Path(__file__).resolve().parent
BEGIN = b"<!-- BEGIN WEB-DEVELOPMENT-COMPANION -->"
END = b"<!-- END WEB-DEVELOPMENT-COMPANION -->"


def sha(data):
    return hashlib.sha256(data).hexdigest()


def atomic(path, data):
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temp = tempfile.mkstemp(prefix=".web-development-", dir=path.parent)
    try:
        with os.fdopen(fd, "wb") as stream:
            stream.write(data)
        os.replace(temp, path)
    finally:
        if os.path.exists(temp):
            os.unlink(temp)


def safe(path, home):
    if not path.resolve().is_relative_to(home.resolve()):
        raise ValueError(f"Target escapes user home: {path}")
    for part in [path, *path.parents]:
        if part == home.parent:
            break
        if part.is_symlink() or (hasattr(part, "is_junction") and part.is_junction()):
            raise ValueError(f"Linked installation target: {part}")


def managed(original, block):
    if original.count(BEGIN) != original.count(END) or original.count(BEGIN) > 1:
        raise ValueError("Malformed or duplicated web companion block")
    if BEGIN in original:
        start, end = original.index(BEGIN), original.index(END) + len(END)
        if end < start:
            raise ValueError("Malformed block order")
        return original[:start] + block + original[end:]
    newline = b"\r\n" if b"\r\n" in original else b"\n"
    return original + (newline * 2 if original else b"") + block + newline


def install(home, check=False):
    home = home.absolute()
    root = home / ".local/share/ai-web-development"
    for name in ["backups", "runs", "inbox", "logs"]:
        safe(root / name, home)
    manifest_path = root / "installation.json"
    safe(manifest_path, home)
    prior = json.loads(manifest_path.read_text("utf-8")) if manifest_path.exists() else {"files": {}}
    edits, next_files = [], {}

    def plan(path, data, global_doc=False):
        safe(path, home)
        old = path.read_bytes() if path.exists() else None
        key = str(path)
        tracked = prior["files"].get(key)
        if not global_doc and old is not None and old != data:
            if not tracked or tracked["sha256"] != sha(old):
                raise ValueError(f"Unmanaged or locally modified target: {path}")
        if old != data:
            edits.append((path, old, data))
        next_files[key] = {"sha256": sha(data), "global_document": global_doc}

    for client, doc, skill_dir in [
        ("Codex", home / ".codex/AGENTS.md", home / ".agents/skills/web-development"),
        ("Claude", home / ".claude/CLAUDE.md", home / ".claude/skills/web-development"),
    ]:
        safe(doc, home)
        original = doc.read_bytes() if doc.exists() else b""
        raw_block = (SOURCE / "routing.md").read_bytes().strip()
        newline = b"\r\n" if b"\r\n" in original else b"\n"
        block = raw_block.replace(b"\r\n", b"\n").replace(b"\n", newline)
        plan(doc, managed(original, block), global_doc=True)
        for source in (SOURCE / "skill").rglob("*"):
            if source.is_file() and "__pycache__" not in source.parts:
                plan(skill_dir / source.relative_to(SOURCE / "skill"), source.read_bytes())

    if os.name == "nt":
        psroot = str(root).replace("'", "''")
        interpreter = str(Path(sys.executable)).replace("'", "''")
        wrapper = ("$ErrorActionPreference='Stop'\n"
                   f"& '{interpreter}' '{str(home / '.agents/skills/web-development/scripts/workflow.py').replace(chr(39), chr(39)*2)}' @args\n"
                   "exit $LASTEXITCODE\n")
        plan(root / "bin/web-development.ps1", wrapper.encode())
        for name in ["start-web-gpt.ps1", "start-web-codex.ps1", "start-rdc.ps1", "stop-rdc.ps1", "check-connections.ps1"]:
            plan(root / "bin" / name, (SOURCE / "launchers" / name).read_bytes())
    else:
        wrapper = '#!/bin/sh\nexec python3 "$HOME/.agents/skills/web-development/scripts/workflow.py" "$@"\n'
        plan(home / ".local/bin/web-development", wrapper.encode())

    changes = [{"path": str(p), "before": sha(old) if old is not None else None,
                "after": sha(data)} for p, old, data in edits]
    if check:
        print(json.dumps({"mode": "check", "up_to_date": not edits, "changes": changes}, ensure_ascii=False))
        return 0 if not edits else 1
    backup = root / "backups" / uuid.uuid4().hex
    if edits:
        backup.mkdir(parents=True)
        # Recheck all preimages before any mutation.
        for path, old, _ in edits:
            now = path.read_bytes() if path.exists() else None
            if now != old:
                raise ValueError(f"Concurrent modification: {path}")
        for i, (path, old, data) in enumerate(edits):
            if old is not None:
                (backup / f"{i}.before").write_bytes(old)
            atomic(path, data)
        atomic(backup / "changes.json", json.dumps(changes, indent=2).encode())
    for name in ["runs", "inbox", "logs"]:
        (root / name).mkdir(parents=True, exist_ok=True)
    manifest = {"version": 1, "source": str(SOURCE), "files": next_files}
    manifest_data = json.dumps(manifest, indent=2).encode()
    if not manifest_path.exists() or manifest_path.read_bytes() != manifest_data:
        atomic(manifest_path, manifest_data)
    if os.name != "nt":
        (home / ".local/bin/web-development").chmod(0o755)
    print(json.dumps({"mode": "install", "changed": len(edits), "backup": str(backup) if edits else None,
                      "root": str(root)}, ensure_ascii=False))
    return 0


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--home", type=Path, default=Path.home())
    parser.add_argument("--check", action="store_true")
    args = parser.parse_args()
    try:
        raise SystemExit(install(args.home, args.check))
    except (OSError, ValueError) as error:
        print(str(error), file=sys.stderr)
        raise SystemExit(2)

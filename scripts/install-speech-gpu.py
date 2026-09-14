"""Install pinned NVIDIA runtime into this checkout, without changing system Python."""
import argparse
import base64
import csv
import hashlib
import json
from pathlib import Path
import subprocess
import sys

parser = argparse.ArgumentParser()
parser.add_argument('--source', type=Path, help='Reuse an existing pip target; verify wheel RECORD hashes')
args = parser.parse_args()
target = Path(__file__).resolve().parents[1] / '.models' / 'gpu'
if target.exists():
    raise SystemExit('GPU target already exists; use a fresh worktree to avoid mixing runtimes')
versions = {'nvidia_cublas_cu12': '12.4.5.8', 'nvidia_cudnn_cu12': '9.1.0.70'}
if args.source:
    source = args.source.resolve()
else:
    source = target.parent / 'gpu-download'
    if source.exists():
        raise SystemExit('Download target already exists')
    subprocess.run([sys.executable, '-m', 'pip', 'install', '--only-binary=:all:', '--no-deps', '--target', str(source),
                    *[f'{name}=={version}' for name, version in versions.items()]], check=True)
entries = {}
for name, version in versions.items():
    record = source / f'{name}-{version}.dist-info' / 'RECORD'
    for path, digest, size in csv.reader(record.open(encoding='utf-8')):
        if not digest:
            continue
        file = (source / path).resolve()
        if not file.is_relative_to(source) or not digest.startswith('sha256='):
            raise SystemExit('Invalid wheel record')
        data = file.read_bytes()
        sha = hashlib.sha256(data).digest()
        if base64.urlsafe_b64encode(sha).decode().rstrip('=') != digest[7:] or len(data) != int(size):
            raise SystemExit(f'Wheel integrity mismatch: {path}')
        # Runtime DLLs plus original distribution metadata and license notices.
        if file.suffix.lower() == '.dll' or '.dist-info/' in path:
            entries[path] = {'sha256': sha.hex(), 'bytes': len(data)}
for path in entries:
    out = target / path
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_bytes((source / path).read_bytes())
(target / 'manifest.json').write_text(json.dumps({'schema': 'nagneon.gpu-runtime/1', 'versions': versions, 'files': entries}, indent=2), encoding='utf-8')
print(json.dumps({'target': str(target), 'files': len(entries)}))

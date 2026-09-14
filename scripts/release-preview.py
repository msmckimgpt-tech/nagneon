"""Build and verify split portable ZIPs from the allowlisted package manifest."""
import hashlib
import json
from pathlib import Path
import zipfile

ROOT = Path(__file__).resolve().parent.parent
package = json.loads((ROOT / 'artifacts/latest-package.json').read_text(encoding='utf-8'))
folder = Path(package['folder']).resolve()
manifest = json.loads(Path(package['manifest']).read_text(encoding='utf-8'))
version = 'v' + manifest['version']
if '-preview.' not in version:
    raise RuntimeError('This builder only publishes preview archives')
out = ROOT / 'artifacts' / ('delivery-' + version)
out.mkdir(exist_ok=False)
extras = {'README-KO.txt': (ROOT / 'docs/PREVIEW-README.txt').read_bytes(),
          'LICENSE-Nagneon.txt': (ROOT / 'LICENSE').read_bytes()}
readme = extras['README-KO.txt']
if version.encode() not in readme:
    raise RuntimeError('README version does not match package')
expected = {}
for item in manifest['files']:
    path = (folder / item['path']).resolve()
    if not path.is_relative_to(folder) or not path.is_file() or path.is_symlink():
        raise RuntimeError('Unexpected package path')
    expected['Nagneon/' + item['path']] = item['sha256']
expected.update({'Nagneon/' + name: hashlib.sha256(data).hexdigest() for name, data in extras.items()})
seen, reports = set(), []
for model in (False, True):
    suffix = 'microphone-model' if model else 'windows-x64-app'
    target = out / f'Nagneon-{version}-{suffix}.zip'
    with zipfile.ZipFile(target, 'x', compression=zipfile.ZIP_DEFLATED, compresslevel=6, allowZip64=True) as archive:
        for item in manifest['files']:
            if item['path'].startswith('resources/speech/microphone-model/') == model:
                archive.write(folder / item['path'], 'Nagneon/' + item['path'])
        if not model:
            for name, data in extras.items():
                archive.writestr('Nagneon/' + name, data)
    with zipfile.ZipFile(target) as archive:
        for name in archive.namelist():
            if name in seen:
                raise RuntimeError('Duplicate ZIP entry: ' + name)
            seen.add(name)
            with archive.open(name) as entry:
                actual = hashlib.file_digest(entry, 'sha256').hexdigest()
            if expected.get(name) != actual:
                raise RuntimeError('ZIP content differs from package: ' + name)
    with target.open('rb') as stream:
        digest = hashlib.file_digest(stream, 'sha256').hexdigest()
    if target.stat().st_size >= 2 * 1024**3:
        raise RuntimeError('Release asset exceeds GitHub size limit')
    reports.append({'name': target.name, 'bytes': target.stat().st_size, 'sha256': digest})
    print(json.dumps(reports[-1]), flush=True)
if seen != set(expected):
    raise RuntimeError('Missing release files')
(out / 'SHA256SUMS.txt').write_text(''.join(f"{r['sha256']}  {r['name']}\n" for r in reports), encoding='ascii')
report = {'passed': True, 'version': version, 'package': package, 'filesVerified': len(seen), 'assets': reports, 'folder': str(out)}
(ROOT / 'artifacts/preview2-delivery.json').write_text(json.dumps(report, indent=2), encoding='utf-8')
print(json.dumps({'passed': True, 'filesVerified': len(seen), 'folder': str(out)}), flush=True)

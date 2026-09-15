import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, join } from 'node:path';
import { distributionComponents } from './lib/distribution-components.mjs';
import { writeRuntimePack } from './lib/runtime-pack.mjs';
import { installRuntimePack } from '../server/runtime-pack.js';
const latest = JSON.parse(await readFile('artifacts/latest-package.json', 'utf8'));
const manifest = JSON.parse(await readFile(latest.manifest, 'utf8'));
const output = resolve('artifacts/runtime-packs-' + new Date().toISOString().replace(/[:.]/g, '-'));
await mkdir(output);
const report = { format: 'nagneon-runtime-catalog/1', sourceManifest: latest.manifest, packageFolder: latest.folder, output, cache: resolve('artifacts/runtime-cache'), verified: false, components: [] };
try {
  for (const component of distributionComponents(manifest.files).filter(c => c.id !== 'app' && c.files.length)) {
    const name = component.id + '-' + component.contentId + '.ngpack';
    const started = Date.now();
    const packed = await writeRuntimePack(latest.folder, component, join(output, name));
    const installed = await installRuntimePack({ archive: join(output,name), component: packed, cache: report.cache });
    report.components.push({ ...packed, archive: { ...packed.archive, name }, verifiedPath: installed.path, elapsedMs: Date.now() - started });
    console.log(JSON.stringify({ id: component.id, unpackedBytes: component.bytes, compressedBytes: packed.archive.bytes, verified: true }));
    await writeFile(join(output,'catalog.json'),JSON.stringify(report,null,2));
  }
  report.verified = true;
} finally {
  await writeFile(join(output,'catalog.json'),JSON.stringify(report,null,2));
  await writeFile('artifacts/latest-runtime-packs.json',JSON.stringify({output,catalog:join(output,'catalog.json'),verified:report.verified},null,2));
}

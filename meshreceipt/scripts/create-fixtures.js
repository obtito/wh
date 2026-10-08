import { mkdir, writeFile } from 'node:fs/promises';
import { makeFixture } from '../test/fixtures.js';
import { DEFAULT_POLICY, optimizeTexture, verifyDelivery } from '../src/receipt.js';

const directory = new URL('../data/fixtures/', import.meta.url);
await mkdir(directory, { recursive: true });
const original = await makeFixture();
const good = await optimizeTexture(original);
const bad = await optimizeTexture(original, { fault: 'drop-animation' });
const changed = await optimizeTexture(original, { fault: 'change-keyframe' });
const unsupported = await makeFixture({ unsupported: true });
for (const [name, bytes] of Object.entries({ 'original.glb': original, 'good.glb': good, 'bad.glb': bad, 'changed.glb': changed, 'unsupported.glb': unsupported })) {
  await writeFile(new URL(name, directory), bytes);
}
await writeFile(new URL('policy.json', directory), `${JSON.stringify(DEFAULT_POLICY, null, 2)}\n`);
for (const [name, bytes] of Object.entries({ good, bad, changed, unsupported })) {
  const report = await verifyDelivery(original, bytes);
  await writeFile(new URL(`${name}.report.json`, directory), `${JSON.stringify(report, null, 2)}\n`);
  console.log(`${name}: ${report.verdict}; original=${original.length} B; output=${bytes.length} B`);
}

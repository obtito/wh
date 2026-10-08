import { readFile, readdir, lstat, mkdir, mkdtemp, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { readPublishedEvidence } from '../server/mainnet-evidence.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const parent = path.join(project, 'data', 'releases');
await readPublishedEvidence();
await mkdir(parent, { recursive: true, mode: 0o700 });
const release = await mkdtemp(path.join(parent, 'meshreceipt-core-'));
const directory = path.join(release, 'meshreceipt'); await mkdir(directory);
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const selectedTests = ['agent', 'bundle', 'chain-evidence', 'contract', 'file-cache-http', 'isolated-demo',
  'model-ui', 'model-workflow', 'receipt', 'workflow', 'mainnet-proof'];
const roots = ['src', 'server', 'web', 'contracts'];
const explicit = ['package.json', 'package-lock.json', 'index.html', 'vite.config.js', '.gitignore', '.env.example',
  'scripts/build-core.js', 'scripts/start-core.js', 'scripts/compile-contract.js', 'scripts/create-fixtures.js',
  'scripts/verify-mainnet.js', 'scripts/check-handoff.js', 'scripts/agent-smoke.js', 'scripts/dev.js', 'scripts/demo-isolated.js',
  'test/fixtures.js', 'experiments/bot-mainnet/protocol.js', 'public/previews/heritage-data.js', 'public/previews/wuhan-data.js',
  'docs/交付包-v1.md', 'docs/release/提交说明.md', 'docs/release/队友验证.md', 'docs/release/四分钟演示.md',
  'docs/release/来源与许可.md', 'docs/evidence/mainnet-original.json', 'docs/evidence/archive-manifest.json',
  'docs/evidence/pavilion-qualified.json', 'docs/evidence/pavilion-failure.json', 'docs/evidence/agent-invocation.json',
  ...selectedTests.map(name => `test/${name}.test.js`)];
async function list(relative) {
  const entries = await readdir(path.join(project, relative), { withFileTypes: true });
  const files = [];
  for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
    if (entry.isSymbolicLink()) throw new Error('Release refuses symlinks');
    const child = `${relative}/${entry.name}`;
    if (entry.isDirectory()) files.push(...await list(child));
    else if (/\.(js|jsx|css|sol)$/.test(entry.name)) files.push(child);
  }
  return files;
}
const names = [...new Set([...explicit, ...(await Promise.all(roots.map(list))).flat()])].sort();
const files = {}, sourceFiles = {};
for (const relative of names) {
  if (!(await lstat(path.join(project, relative))).isFile()) throw new Error(`Not a regular release file: ${relative}`);
  const original = await readFile(path.join(project, relative));
  sourceFiles[relative] = digest(original);
  let bytes = original;
  if (relative === 'package.json') {
    const manifest = JSON.parse(original);
    manifest.scripts = { build: 'node scripts/build-core.js', start: 'node --env-file-if-exists=.env scripts/start-core.js',
      test: `node --test ${selectedTests.map(name => `test/${name}.test.js`).join(' ')}`, fixtures: 'node scripts/create-fixtures.js',
      verify: 'node src/cli.js', consume: 'node src/consume.js', 'mainnet:verify': 'node scripts/verify-mainnet.js',
      'handoff:check': 'node scripts/check-handoff.js', 'agent:smoke': 'node --env-file-if-exists=.env scripts/agent-smoke.js' };
    bytes = Buffer.from(`${JSON.stringify(manifest, null, 2)}\n`);
  }
  const target = path.join(directory, relative); await mkdir(path.dirname(target), { recursive: true });
  await writeFile(target, bytes, { flag: 'wx' }); files[relative] = { bytes: bytes.length, sha256: digest(bytes) };
}
const readme = await readFile(new URL('../docs/release/README.core.md', import.meta.url));
await writeFile(path.join(directory, 'README.md'), readme, { flag: 'wx' }); files['README.md'] = { bytes: readme.length, sha256: digest(readme) };
for (const [relative, expected] of Object.entries(sourceFiles)) {
  if (digest(await readFile(path.join(project, relative))) !== expected) throw new Error(`Source changed while freezing: ${relative}`);
}
const fingerprint = digest(Buffer.from(JSON.stringify(files)));
await writeFile(path.join(directory, 'RELEASE.json'), `${JSON.stringify({ schema: 'meshreceipt.core-release.v1',
  createdAt: new Date().toISOString(), fingerprint, coreOnly: true, files, sourceFiles,
  sourceLicense: 'Project-wide distribution license requires team confirmation; third-party terms retained.',
  excludes: ['.env', 'private keys', 'publisher database', 'third-party landmark models', 'node_modules', 'old dist'] }, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ releaseDirectory: directory, fingerprint, files: Object.keys(files).length, publicationPerformed: false }, null, 2));

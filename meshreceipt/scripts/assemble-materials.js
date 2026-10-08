import { readFile, mkdir, mkdtemp, writeFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const [candidateArg, qaArg] = process.argv.slice(2);
if (!candidateArg || !qaArg) throw new Error('Usage: node scripts/assemble-materials.js RELEASE_DIRECTORY SUCCESSFUL_QA_DIRECTORY');
const candidate = path.resolve(candidateArg), qa = path.resolve(qaArg);
const project = fileURLToPath(new URL('../', import.meta.url));
const release = JSON.parse(await readFile(path.join(candidate, 'RELEASE.json')));
const checked = JSON.parse(await readFile(path.join(qa, 'browser-result.json')));
if (checked.status !== 'passed' || checked.fingerprint !== release.fingerprint) throw new Error('Recording does not match a successful frozen release');
const parent = path.join(project, 'data', 'deliveries'); await mkdir(parent, { recursive: true, mode: 0o700 });
const output = await mkdtemp(path.join(parent, 'meshreceipt-20261008-'));
const selections = [
  [path.join(candidate, '..', 'meshreceipt-core-source.tar.gz'), 'meshreceipt-core-source.tar.gz'],
  [path.join(qa, 'meshreceipt-core-demo.webm'), 'meshreceipt-core-demo.webm'],
  [path.join(qa, 'browser-result.json'), 'browser-result.json'],
  [path.join(candidate, 'RELEASE.json'), 'RELEASE.json'],
  ...['01-home', '02-original-model', '03-failure-and-pass', '04-export', '05-consumer-model',
    '06-historical-evidence', '07-mainnet-read', '08-history-reuse', '09-mobile-home', '10-mobile-controls']
    .map(name => [path.join(qa, `${name}.png`), `screenshots/${name}.png`]),
  ...['提交前清单', 'README.core', '提交说明', '来源与许可', '队友验证', '四分钟演示', '执行记录-2026-10-08']
    .map(name => [path.join(project, 'docs', 'release', `${name}.md`), `${name === 'README.core' ? '运行说明' : name}.md`]),
  ...['mainnet-original', 'archive-manifest', 'pavilion-qualified', 'pavilion-failure', 'agent-invocation']
    .map(name => [path.join(candidate, 'docs', 'evidence', `${name}.json`), `evidence/${name}.json`]),
];
const files = {};
for (const [source, relative] of selections) {
  if (!(await lstat(source)).isFile()) throw new Error('Materials refuse non-regular files');
  const bytes = await readFile(source), target = path.join(output, relative);
  await mkdir(path.dirname(target), { recursive: true }); await writeFile(target, bytes, { flag: 'wx' });
  files[relative] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
const manifest = { schema: 'meshreceipt.submission-materials.v1', createdAt: new Date().toISOString(),
  sourceFingerprint: release.fingerprint, files, externalComputerConfirmed: false, submitted: false, published: false,
  pending: ['team and members', 'project-wide license', 'repository and accessible video links', 'teammate external computer check',
    'GCC/dual-track organizer confirmation', 'authorized submission and receipt'], video: { durationSeconds: 90, width: 1440, height: 1000, fps: 25, audio: false } };
await writeFile(path.join(output, 'MATERIALS.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ output, sourceFingerprint: release.fingerprint, files: selections.length + 1, submitted: false, published: false }, null, 2));

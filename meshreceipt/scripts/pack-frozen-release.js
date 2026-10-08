import { readFile, lstat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createWriteStream } from 'node:fs';
import { spawn } from 'node:child_process';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';

const [directory, target, mode] = process.argv.slice(2);
if (!directory || !target || (mode && mode !== '--materials')) throw new Error('Usage: node scripts/pack-frozen-release.js RELEASE_DIRECTORY NEW_ARCHIVE [--materials]');
const root = path.resolve(directory), archive = path.resolve(target);
const manifestName = mode === '--materials' ? 'MATERIALS.json' : 'RELEASE.json';
const manifest = JSON.parse(await readFile(path.join(root, manifestName)));
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
if (mode === '--materials') {
  const release = JSON.parse(await readFile(path.join(root, 'RELEASE.json')));
  if (manifest.schema !== 'meshreceipt.submission-materials.v1' || manifest.sourceFingerprint !== release.fingerprint) throw new Error('Materials source fingerprint mismatch');
} else if (manifest.schema !== 'meshreceipt.core-release.v1' || digest(Buffer.from(JSON.stringify(manifest.files))) !== manifest.fingerprint) {
  throw new Error('Release manifest fingerprint mismatch');
}
const names = [...Object.keys(manifest.files).sort(), manifestName];
for (const name of names) {
  if (path.isAbsolute(name) || name.split('/').some(part => part === '..' || !part) || name.startsWith('-')) throw new Error('Unsafe release path');
  const file = path.join(root, name);
  if (!(await lstat(file)).isFile()) throw new Error(`Not a regular release file: ${name}`);
  if (name !== manifestName) {
    const bytes = await readFile(file), expected = manifest.files[name];
    if (bytes.length !== expected.bytes || digest(bytes) !== expected.sha256) throw new Error(`Frozen file changed: ${name}`);
  }
}
try { await lstat(archive); throw new Error('Archive already exists; refusing overwrite'); }
catch (error) { if (error.code !== 'ENOENT') throw error; }
const child = spawn('tar', ['-czf', '-', '-C', root, '--', ...names], { stdio: ['ignore', 'pipe', 'inherit'] });
const finished = new Promise((resolve, reject) => {
  child.once('error', reject); child.once('exit', code => code === 0 ? resolve() : reject(new Error(`tar exited ${code}`)));
});
await Promise.all([pipeline(child.stdout, createWriteStream(archive, { flags: 'wx' })), finished]);
const bytes = await readFile(archive);
console.log(JSON.stringify({ archive, sourceFingerprint: manifest.sourceFingerprint ?? manifest.fingerprint, entries: names.length, bytes: bytes.length,
  sha256: digest(bytes), publicationPerformed: false }, null, 2));

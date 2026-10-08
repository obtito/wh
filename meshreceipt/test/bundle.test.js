import test, { before, after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, readdir, access, symlink } from 'node:fs/promises';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import os from 'node:os';
import path from 'node:path';
import { Wallet } from 'ethers';
import { NodeIO } from '@gltf-transform/core';
import { createApp } from '../server/index.js';
import { BUNDLE_FILES, consumeBundle, parseBundle, verifyBundle, bundleSealMessage, readBoundedFile, MAX_BUNDLE_BYTES } from '../src/bundle.js';
import { hashJSON, canonicalJSON, sha256, LIMITS } from '../src/receipt.js';

const exec = promisify(execFile);
let directory, app, task, passed, failed, qualified, evidence, trusted, evidenceTrust;
before(async () => {
  directory = await mkdtemp(path.join(os.tmpdir(), 'meshreceipt-bundle-'));
  app = await createApp({ directory: path.join(directory, 'publisher'), env: {} });
  const created = await app.jobs.create({ assetId: 'pavilion', mode: 'demo', instruction: 'Do not export this private instruction' });
  await app.jobs.idle(); task = await app.store.get(created.id);
  [failed, passed] = task.attempts;
  assert.deepEqual(task.attempts.map(item => item.verdict), ['FAIL', 'PASS']);
  qualified = JSON.parse((await app.exportBundle(task.id, passed.id, { kind: 'qualified', confirmDistribution: true })).serialized);
  evidence = JSON.parse((await app.exportBundle(task.id, failed.id, { kind: 'evidence', confirmDistribution: true })).serialized);
  trusted = { issuer: passed.delivery.issuer, instance: passed.delivery.instance, providerId: passed.providerId };
  evidenceTrust = { issuer: failed.delivery.issuer, instance: failed.delivery.instance, providerId: failed.providerId };
});
after(async () => { if (directory) await rm(directory, { recursive: true, force: true }); });

async function reseal(bundle) {
  const signer = app.store.providers.find(item => item.id === bundle.manifest.attempt.providerId);
  bundle.seal.manifestHash = hashJSON(bundle.manifest);
  bundle.seal.signature = await signer.wallet.signMessage(bundleSealMessage(bundle.seal.instance, bundle.seal.manifestHash, bundle.schema));
}
function replaceFile(bundle, name, bytes) {
  bundle.files[name] = bytes.toString('base64');
  bundle.manifest.files[name] = { bytes: bytes.length, sha256: sha256(bytes) };
}

test('self-contained qualified release verifies and opens outside publisher storage', async () => {
  const file = path.join(directory, 'transfer.json'), output = path.join(directory, 'consumer');
  await writeFile(file, JSON.stringify(qualified));
  const result = await consumeBundle(file, trusted, output);
  assert.equal(result.qualified, true); assert.equal(result.verdict, 'PASS'); assert.equal(result.recomputed, true);
  assert.equal(result.manifestHash, qualified.seal.manifestHash);
  assert.deepEqual((await readdir(output)).sort(), [...BUNDLE_FILES, 'manifest.json', 'seal.json', 'verification.json'].sort());
  const bytes = await readFile(path.join(output, 'model.glb'));
  const doc = await new NodeIO().readBinary(bytes);
  assert.ok(doc.getRoot().listMeshes().length > 0);
  assert.equal(doc.getRoot().listAnimations().length, 1);
  assert.equal(sha256(bytes), passed.outputHash);
});

test('export is deterministic and contains only allowlisted files, never database or secrets', async () => {
  const again = JSON.parse((await app.exportBundle(task.id, passed.id, { kind: 'qualified', confirmDistribution: true })).serialized);
  assert.deepEqual(again, qualified);
  const serialized = JSON.stringify(qualified);
  assert.deepEqual(Object.keys(qualified.files), BUNDLE_FILES);
  assert.ok(!serialized.includes('privateKey'));
  assert.ok(!serialized.includes('Do not export this private instruction'));
  assert.ok(!serialized.includes(directory));
  for (const provider of app.store.providers) assert.ok(!serialized.includes(provider.wallet.privateKey));
});

test('FAIL cannot become a qualified asset, but evidence independently recomputes FAIL', async () => {
  await assert.rejects(app.exportBundle(task.id, failed.id, { kind: 'qualified', confirmDistribution: true }), /Only PASS/);
  const verified = await verifyBundle(evidence, evidenceTrust);
  assert.equal(verified.result.verdict, 'FAIL'); assert.equal(verified.result.qualified, false);
  assert.equal(verified.result.integrity, true); assert.equal(verified.result.signatureValid, true);
  const forged = structuredClone(evidence); forged.manifest.kind = 'qualified'; await reseal(forged);
  await assert.rejects(verifyBundle(forged, evidenceTrust), /Only PASS/);
});

test('PASS exported for evidence remains evidence, not a qualified release', async () => {
  const bundle = JSON.parse((await app.exportBundle(task.id, passed.id, { kind: 'evidence', confirmDistribution: true })).serialized);
  const { result } = await verifyBundle(bundle, trusted);
  assert.equal(result.verdict, 'PASS'); assert.equal(result.qualified, false); assert.equal(result.kind, 'evidence');
});

test('explicit original/output distribution consent is required', async () => {
  for (const options of [{ kind: 'qualified' }, { kind: 'qualified', confirmDistribution: false }, { kind: 'qualified', confirmDistribution: true, source: {} }]) {
    await assert.rejects(app.exportBundle(task.id, passed.id, options), /explicitly confirm/);
  }
});

test('legacy or missing source authorization blocks qualified AND evidence export', async () => {
  const original = await app.store.get(task.id);
  try {
    const changed = structuredClone(original); delete changed.distributionSource; await app.store.save(changed);
    for (const kind of ['qualified', 'evidence']) await assert.rejects(app.exportBundle(task.id, passed.id, { kind, confirmDistribution: true }), /authorization/);
    changed.distributionSource = { ...original.distributionSource, inputHash: '0'.repeat(64) }; await app.store.save(changed);
    await assert.rejects(app.exportBundle(task.id, passed.id, { kind: 'qualified', confirmDistribution: true }), /authorization/);
  } finally { await app.store.save(original); }
});

test('trusted identity must be independently configured, not inherited from bundle', async () => {
  await assert.rejects(verifyBundle(qualified), /Explicit trusted/);
  await assert.rejects(verifyBundle(qualified, { ...trusted, issuer: Wallet.createRandom().address }), /identity/);
  await assert.rejects(verifyBundle(qualified, { ...trusted, instance: '12345678-1234-4234-8234-123456789abc' }), /identity/);
  await assert.rejects(verifyBundle(qualified, { ...trusted, providerId: 'unknown' }), /context/);
});

test('modified binary, metadata and manifest signatures are rejected', async () => {
  const binary = structuredClone(qualified);
  const bytes = Buffer.from(binary.files['model.glb'], 'base64'); bytes[bytes.length - 1] ^= 1;
  binary.files['model.glb'] = bytes.toString('base64');
  await assert.rejects(verifyBundle(binary, trusted), /File integrity/);
  const metadata = structuredClone(qualified); metadata.manifest.source.creator = 'Another author';
  await assert.rejects(verifyBundle(metadata, trusted), /seal/);
  const signature = structuredClone(qualified); signature.seal.signature = '0x' + '00'.repeat(65);
  await assert.rejects(verifyBundle(signature, trusted));
});

test('signed packaging cannot conceal a changed delivery signature or task binding', async () => {
  const bundle = structuredClone(qualified), delivery = JSON.parse(Buffer.from(bundle.files['delivery.json'], 'base64'));
  delivery.payload.taskId = '12345678-1234-4234-8234-123456789abc';
  replaceFile(bundle, 'delivery.json', Buffer.from(canonicalJSON(delivery))); await reseal(bundle);
  await assert.rejects(verifyBundle(bundle, trusted), /Delivery context/);
});

test('even a correctly signed report must match actual independent recomputation', async () => {
  const bundle = structuredClone(qualified), report = JSON.parse(Buffer.from(bundle.files['report.json'], 'base64'));
  report.checks[0].claimed = 'unsupported claim';
  const { reportHash, ...core } = report; report.reportHash = hashJSON(core);
  replaceFile(bundle, 'report.json', Buffer.from(canonicalJSON(report)));
  bundle.manifest.attempt.reportHash = report.reportHash; await reseal(bundle);
  await assert.rejects(verifyBundle(bundle, trusted), /Recomputation mismatch/);
});

test('reject unsupported schema, unsafe names, extra or missing files and oversized entries', async () => {
  const version = structuredClone(qualified); version.schema = 'meshreceipt.bundle.v999';
  await assert.rejects(verifyBundle(version, trusted), /schema/);
  for (const name of ['../outside', '/tmp/outside', '.env', '__proto__']) {
    const bundle = structuredClone(qualified);
    Object.defineProperty(bundle.files, name, { value: 'AA==', enumerable: true });
    await assert.rejects(verifyBundle(bundle, trusted), /file list/);
  }
  const missing = structuredClone(qualified); delete missing.files['original.glb'];
  await assert.rejects(verifyBundle(missing, trusted), /file list/);
  const oversized = structuredClone(qualified); oversized.manifest.files['model.glb'].bytes = LIMITS.bytes + 1; await reseal(oversized);
  await assert.rejects(verifyBundle(oversized, trusted), /bounds/);
  const encoding = structuredClone(qualified); encoding.files['model.glb'] += '\n';
  await assert.rejects(verifyBundle(encoding, trusted), /base64/);
  assert.throws(() => parseBundle(' '.repeat(MAX_BUNDLE_BYTES + 1)), /size limit/);
});

test('verification failure writes nothing and existing extraction directory is never overwritten', async () => {
  const bad = structuredClone(qualified); bad.manifest.source.title = 'Tampered';
  const file = path.join(directory, 'bad.json'), output = path.join(directory, 'must-not-exist');
  await writeFile(file, JSON.stringify(bad));
  await assert.rejects(consumeBundle(file, trusted, output));
  await assert.rejects(access(output), { code: 'ENOENT' });
  const good = path.join(directory, 'good.json'); await writeFile(good, JSON.stringify(qualified));
  await assert.rejects(consumeBundle(good, trusted, directory), { code: 'EEXIST' });
});

test('bounded file reader rejects directories and symbolic links', async () => {
  await assert.rejects(readBoundedFile(directory, MAX_BUNDLE_BYTES), /bounds/);
  const source = path.join(directory, 'link-source.json'), link = path.join(directory, 'link.json');
  await writeFile(source, '{}'); await symlink(source, link);
  await assert.rejects(readBoundedFile(link, MAX_BUNDLE_BYTES));
  await assert.rejects(readBoundedFile(source, 1), /bounds/);
});

test('FIFO bundle input is rejected without waiting for a writer', { skip: process.platform === 'win32' }, async () => {
  const fifo = path.join(directory, 'blocked-input.json');
  await exec('mkfifo', [fifo]);
  const reader = new URL('../src/file-reader.js', import.meta.url).href;
  // Isolate the read: a regression must fail on timeout, not hang the test runner.
  const code = `import { readBoundedFile } from ${JSON.stringify(reader)};
    try { await readBoundedFile(process.argv[1], 1024); process.exitCode = 1; }
    catch (error) { console.log(error.message); }`;
  const run = await exec(process.execPath, ['--input-type=module', '-e', code, fifo], { timeout: 2500 });
  assert.match(run.stdout, /bounds/);
});

test('regular input replaced by a FIFO between stat and open cannot block', { skip: process.platform === 'win32' }, async () => {
  const file = path.join(directory, 'race-input.json'); await writeFile(file, '{}');
  const reader = new URL('../src/file-reader.js', import.meta.url).href;
  // Change a real file precisely after lstat, in an isolated process. This exercises O_NONBLOCK.
  const code = `import fs from 'node:fs/promises';
    import { execFileSync } from 'node:child_process';
    import { syncBuiltinESMExports } from 'node:module';
    const file = process.argv[1], original = fs.lstat;
    fs.lstat = async name => {
      const info = await original(name);
      if (name === file) { await fs.unlink(file); execFileSync('mkfifo', [file]); }
      return info;
    };
    syncBuiltinESMExports();
    const { readBoundedFile } = await import(${JSON.stringify(reader)});
    try { await readBoundedFile(file, 1024); process.exitCode = 1; }
    catch (error) { console.log(error.message); }`;
  const run = await exec(process.execPath, ['--input-type=module', '-e', code, file], { timeout: 2500 });
  assert.match(run.stdout, /bounds/);
});

test('v2 includes signed usage instructions, tool versions and safety boundaries', async () => {
  assert.equal(qualified.schema, 'meshreceipt.bundle.v2');
  const instructions = Buffer.from(qualified.files['README.txt'], 'base64').toString('utf8');
  const report = JSON.parse(Buffer.from(qualified.files['report.json'], 'base64'));
  for (const text of ['Node.js', 'npm ci --ignore-scripts', 'npm run consume --', '--issuer', '--instance', '--provider', '--out',
    '可信渠道', 'seal.json', 'model.glb', '视觉', '退出码', 'CC0', ...Object.values(report.tools)]) {
    assert.ok(instructions.includes(text), `Missing instructions: ${text}`);
  }
  const changed = structuredClone(qualified);
  changed.files['README.txt'] = Buffer.from(instructions.replace('Node.js', 'Fake.js')).toString('base64');
  await assert.rejects(verifyBundle(changed, trusted), /File integrity/);
  const missing = structuredClone(qualified);
  delete missing.files['README.txt']; delete missing.manifest.files['README.txt']; await reseal(missing);
  await assert.rejects(verifyBundle(missing, trusted), /file list/);
});

test('legacy v1 five-file bundles still verify and retain their original publication seal', async () => {
  const legacy = structuredClone(qualified);
  legacy.schema = 'meshreceipt.bundle.v1'; legacy.manifest.schema = 'meshreceipt.release.v1';
  delete legacy.files['README.txt']; delete legacy.manifest.files['README.txt'];
  legacy.seal.scheme = 'meshreceipt.bundle.v1/EIP-191'; await reseal(legacy);
  const file = path.join(directory, 'legacy.json'), output = path.join(directory, 'legacy-consumer');
  await writeFile(file, JSON.stringify(legacy));
  const result = await consumeBundle(file, trusted, output);
  assert.equal(result.schema, 'meshreceipt.bundle.v1'); assert.equal(result.qualified, true);
  assert.deepEqual(JSON.parse(await readFile(path.join(output, 'seal.json'), 'utf8')), legacy.seal);
  assert.ok(!(await readdir(output)).includes('README.txt'));
  const changed = structuredClone(legacy); changed.manifest.source.creator = 'Tampered legacy author';
  await assert.rejects(verifyBundle(changed, trusted), /seal/);
});

test('bundle versions cannot reuse another version\'s release schema or signature domain', async () => {
  const downgraded = structuredClone(qualified); downgraded.schema = 'meshreceipt.bundle.v1';
  await assert.rejects(verifyBundle(downgraded, trusted), /schema/);
  const signer = app.store.providers.find(item => item.id === passed.providerId);
  const wrongDomain = structuredClone(qualified);
  wrongDomain.seal.signature = await signer.wallet.signMessage(`meshreceipt.bundle.v1:${trusted.instance}:${wrongDomain.seal.manifestHash}`);
  await assert.rejects(verifyBundle(wrongDomain, trusted), /signature/);
});

test('extracted directory alone preserves signed publication evidence for independent reverification', async () => {
  const file = path.join(directory, 'extract-only.json'), output = path.join(directory, 'extract-only');
  await writeFile(file, JSON.stringify(qualified));
  const first = await consumeBundle(file, trusted, output);
  await rm(file); // The recipient retains only the extracted directory and out-of-band trust.
  const manifest = JSON.parse(await readFile(path.join(output, 'manifest.json'), 'utf8'));
  const seal = JSON.parse(await readFile(path.join(output, 'seal.json'), 'utf8'));
  const files = Object.fromEntries(await Promise.all(Object.keys(manifest.files).map(async name => [name, (await readFile(path.join(output, name))).toString('base64')])));
  const { result } = await verifyBundle({ schema: seal.scheme.replace('/EIP-191', ''), manifest, seal, files }, trusted);
  assert.equal(result.manifestHash, first.manifestHash); assert.equal(result.qualified, true);
  assert.equal(result.signatureValid, true); assert.equal(result.recomputed, true);
});

test('server rechecks exact disk bytes instead of trusting a previous PASS', async () => {
  const file = path.join(app.store.taskPath(task.id), passed.id, 'model.glb'), original = await readFile(file);
  try {
    const changed = Buffer.from(original); changed[changed.length - 1] ^= 1; await writeFile(file, changed);
    await assert.rejects(app.exportBundle(task.id, passed.id, { kind: 'qualified', confirmDistribution: true }), /commitment/);
  } finally { await writeFile(file, original); }
});

test('standalone CLI needs no publisher database and preserves qualified/evidence exit codes', async () => {
  const cli = fileURLToPath(new URL('../src/consume.js', import.meta.url));
  const file = path.join(directory, 'cli-qualified.json'); await writeFile(file, JSON.stringify(qualified));
  const args = (bundleFile, trust) => [cli, bundleFile, '--issuer', trust.issuer, '--instance', trust.instance, '--provider', trust.providerId];
  const run = await exec(process.execPath, args(file, trusted), { cwd: os.tmpdir() });
  assert.equal(JSON.parse(run.stdout).qualified, true);
  const failureFile = path.join(directory, 'cli-evidence.json'); await writeFile(failureFile, JSON.stringify(evidence));
  await assert.rejects(exec(process.execPath, args(failureFile, evidenceTrust), { cwd: os.tmpdir() }), error => {
    assert.equal(error.code, 1); assert.equal(JSON.parse(error.stdout).verdict, 'FAIL'); return true;
  });
  await assert.rejects(exec(process.execPath, [cli, file]), error => { assert.equal(error.code, 3); return true; });
});

test('HTTP package export is explicit POST; FAIL raw downloads remain available', async t => {
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  const base = `http://127.0.0.1:${app.server.address().port}/api/tasks/${task.id}/attempts`;
  const headers = { 'content-type': 'application/json', 'x-meshreceipt': 'local-demo' };
  assert.equal((await fetch(`${base}/${passed.id}/bundle`)).status, 404);
  assert.equal((await fetch(`${base}/${passed.id}/bundle`, { method: 'POST', body: '{}' })).status, 400);
  assert.equal((await fetch(`${base}/${passed.id}/bundle`, { method: 'POST', headers: { ...headers, origin: 'https://evil.example' }, body: '{}' })).status, 403);
  const rejected = await fetch(`${base}/${failed.id}/bundle`, { method: 'POST', headers, body: JSON.stringify({ kind: 'qualified', confirmDistribution: true }) });
  assert.equal(rejected.status, 400);
  assert.equal((await fetch(`${base}/${failed.id}/model`)).status, 200);
  const response = await fetch(`${base}/${passed.id}/bundle`, { method: 'POST', headers, body: JSON.stringify({ kind: 'qualified', confirmDistribution: true }) });
  assert.equal(response.status, 200); assert.match(response.headers.get('content-disposition'), /attachment; filename="meshreceipt-qualified-/);
  const { result } = await verifyBundle(await response.json(), trusted); assert.equal(result.qualified, true);
});

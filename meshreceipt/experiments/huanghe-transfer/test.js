import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm, access, cp, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { brotliCompressSync } from 'node:zlib';
import { Document, NodeIO } from '@gltf-transform/core';
import { Wallet } from 'ethers';
import { sha256 } from '../../src/receipt.js';
import { LIMITS, POLICY, validatePolicy, inspectModel, packModel, unpackModel, verifyTransfer } from './codec.js';
import { createTask, consumeTask, exportTransport } from './delivery.js';

const document = new Document(), buffer = document.createBuffer();
const positions = document.createAccessor('positions').setBuffer(buffer).setType('VEC3').setArray(new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]));
const indices = document.createAccessor('indices').setBuffer(buffer).setType('SCALAR').setArray(new Uint16Array([0, 1, 2]));
const mesh = document.createMesh('Test mesh').addPrimitive(document.createPrimitive().setAttribute('POSITION', positions).setIndices(indices));
const scene = document.createScene('Test scene'); document.getRoot().setDefaultScene(scene);
for (let i = 0; i < 20; i++) scene.addChild(document.createNode(`Node-${i}`).setMesh(mesh).setTranslation([i, 0, 0]));
const input = Buffer.from(await new NodeIO().writeBinary(document));
const policy = { ...POLICY, requiredNodes: ['Node-0'] }, packed = await packModel(input, policy);
const badPacked = await packModel(input, policy, { controlledFault: true });

async function fixture(t, negativeControl = false) {
  const root = await mkdtemp(path.join(tmpdir(), 'meshreceipt-huanghe-tests-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const inputFile = path.join(root, 'fixture.glb'), sourceFile = path.join(root, 'source.json'), directory = path.join(root, 'delivery');
  await writeFile(inputFile, input);
  await writeFile(sourceFile, JSON.stringify({ sha256: sha256(input), license: 'Project-owned synthetic test fixture; local evaluation only' }));
  const result = await createTask({ inputFile, sourceFile, outputDirectory: directory, policy, negativeControl });
  return { root, inputFile, sourceFile, directory, result, trusted: result.trustedIdentity };
}

test('policy rejects unknown versions, switches, out-of-bounds sizes and duplicate nodes', () => {
  for (const changed of [{ ...policy, version: 'meshreceipt.texture-only.v1' }, { ...policy, skipIdentity: true },
    { ...policy, brotliQuality: 11 }, { ...policy, maxInputBytes: LIMITS.inputBytes + 1 },
    { ...policy, maxTransferBytes: Infinity }, { ...policy, minReductionBps: 0 }, { ...policy, requiredNodes: ['Node-0', 'Node-0'] }]) {
    assert.throws(() => validatePolicy(changed));
  }
});
test('lossless transfer meets frozen rules and preserves exact model bytes', async () => {
  const report = await verifyTransfer(input, packed, policy);
  assert.equal(report.verdict, 'PASS'); assert.equal(report.inputHash, report.outputHash);
  assert.equal(report.original.summary.nodeCount, 20); assert.equal(report.original.summary.meshCount, 1);
  assert.equal(report.checks.length, 6); assert.deepEqual(await unpackModel(packed, policy), input);
});
test('recomputation is deterministic; runtime timing is not included in report hash', async () => {
  assert.deepEqual(await verifyTransfer(input, packed, policy), await verifyTransfer(input, packed, policy));
});
test('controlled single-byte model corruption fails despite valid compression', async () => {
  const report = await verifyTransfer(input, badPacked, policy);
  assert.equal(report.verdict, 'FAIL');
  assert.equal(report.checks.find(c => c.id === 'bounded-decompression').pass, true);
  assert.equal(report.checks.find(c => c.id === 'byte-identical-model').pass, false);
});
test('truncated Brotli is rejected', async () => {
  const report = await verifyTransfer(input, packed.subarray(0, 3), policy);
  assert.equal(report.verdict, 'FAIL'); assert.equal(report.checks.find(c => c.id === 'bounded-decompression').pass, false);
});
test('trailing compressed-stream garbage is rejected', async () => {
  const report = await verifyTransfer(input, Buffer.concat([packed, Buffer.from('garbage')]), policy);
  assert.equal(report.verdict, 'FAIL'); assert.match(report.checks.find(c => c.id === 'bounded-decompression').reason, /Trailing/);
});
test('decompression expansion is bounded before model extraction', async () => {
  const bomb = brotliCompressSync(Buffer.alloc(input.length + 100_000));
  const report = await verifyTransfer(input, bomb, { ...policy, maxInputBytes: input.length + 10 });
  assert.equal(report.verdict, 'FAIL'); assert.equal(report.checks.find(c => c.id === 'bounded-decompression').pass, false);
});
test('transfer size, reduction threshold and required nodes are independent checks', async () => {
  assert.equal((await verifyTransfer(input, packed, { ...policy, maxTransferBytes: 20 })).verdict, 'FAIL');
  assert.equal((await verifyTransfer(input, packed, { ...policy, minReductionBps: 9900 })).verdict, 'FAIL');
  assert.equal((await verifyTransfer(input, packed, { ...policy, requiredNodes: ['Missing'] })).verdict, 'FAIL');
});
test('oversized and corrupt originals are not passed', async () => {
  assert.equal((await inspectModel(Buffer.alloc(LIMITS.inputBytes + 1), policy)).status, 'INVALID');
  assert.equal((await verifyTransfer(Buffer.from('bad input'), packed, policy)).verdict, 'INCONCLUSIVE');
});
function headerOnly(json) {
  const bytes = Buffer.from(JSON.stringify(json));
  const padded = Buffer.alloc(Math.ceil(bytes.length / 4) * 4, 32); bytes.copy(padded);
  const glb = Buffer.alloc(20 + padded.length);
  glb.writeUInt32LE(0x46546c67, 0); glb.writeUInt32LE(2, 4); glb.writeUInt32LE(glb.length, 8);
  glb.writeUInt32LE(padded.length, 12); glb.writeUInt32LE(0x4e4f534a, 16); padded.copy(glb, 20);
  return glb;
}
test('external resources and unsupported extensions are refused before resource loading', async () => {
  for (const json of [{ asset: { version: '2.0' }, buffers: [{ byteLength: 16, uri: 'file:///etc/passwd' }] },
    { asset: { version: '2.0' }, extensionsUsed: ['EXT_meshopt_compression'] },
    { asset: { version: '2.0' }, nodes: Array.from({ length: 501 }, (_, i) => ({ name: `N${i}` })) }]) {
    assert.equal((await inspectModel(headerOnly(json), policy)).status, 'UNSUPPORTED');
  }
});
test('signed folder can be independently verified and restored in a new directory', async t => {
  const f = await fixture(t), out = path.join(f.root, 'recipient');
  const result = await consumeTask(f.directory, f.trusted, out);
  assert.equal(result.verdict, 'PASS'); assert.equal(result.signatureValid, true); assert.equal(result.recomputed, true);
  assert.equal(result.redistributionAuthorized, false); assert.deepEqual(await readFile(path.join(out, 'model.glb')), input);
  assert.equal((await readFile(path.join(out, 'seal.json'))).length > 0, true);
  assert.equal((await consumeTask(out, f.trusted)).verdict, 'PASS');
});
test('consumer refuses to trust an issuer merely embedded in the folder', async t => {
  const f = await fixture(t);
  await assert.rejects(consumeTask(f.directory, null), /Explicit trusted/);
  await assert.rejects(consumeTask(f.directory, { ...f.trusted, issuer: Wallet.createRandom().address }), /identity mismatch/);
  await assert.rejects(consumeTask(f.directory, { ...f.trusted, inputHash: '0'.repeat(64) }), /original input hash mismatch/);
});
test('compact transport omits original but independently reconstructs against a separately trusted input hash', async t => {
  const f = await fixture(t), compact = path.join(f.root, 'compact'), recipient = path.join(f.root, 'recipient');
  const exported = await exportTransport(f.directory, f.trusted, compact);
  assert.equal(exported.originalFileOmitted, true); await assert.rejects(access(path.join(compact, 'original.glb')));
  const verified = await consumeTask(compact, f.trusted, recipient);
  assert.equal(verified.originalSource, 'reconstructed-from-transfer-and-trusted-hash');
  assert.deepEqual(await readFile(path.join(recipient, 'model.glb')), input);
  assert.equal((await consumeTask(recipient, f.trusted)).verdict, 'PASS');
});
test('tampering a transferred file is rejected before creating an extraction directory', async t => {
  const f = await fixture(t), tampered = path.join(f.root, 'tampered'), out = path.join(f.root, 'refused-output');
  await cp(f.directory, tampered, { recursive: true });
  const bytes = await readFile(path.join(tampered, 'model.glb.br')); bytes[0] ^= 1;
  await writeFile(path.join(tampered, 'model.glb.br'), bytes);
  await assert.rejects(consumeTask(tampered, f.trusted, out), /File integrity mismatch/);
  await assert.rejects(access(out));
});
test('manifest modification cannot grant redistribution permission', async t => {
  const f = await fixture(t), manifestFile = path.join(f.directory, 'manifest.json');
  const manifest = JSON.parse(await readFile(manifestFile)); manifest.rights.redistribution = 'authorized';
  await writeFile(manifestFile, JSON.stringify(manifest));
  await assert.rejects(consumeTask(f.directory, f.trusted), /manifest signature/);
});
test('FAIL remains valid evidence but cannot be extracted as a qualified model', async t => {
  const f = await fixture(t, true), out = path.join(f.root, 'fail-output');
  const result = await consumeTask(f.directory, f.trusted);
  assert.equal(result.verdict, 'FAIL'); assert.equal(result.byteIdentical, false);
  await assert.rejects(consumeTask(f.directory, f.trusted, out), /Only PASS/); await assert.rejects(access(out));
});
test('source mismatch and existing extraction folders are refused without overwrite', async t => {
  const f = await fixture(t), existing = path.join(f.root, 'existing');
  await cp(f.directory, existing, { recursive: true });
  await assert.rejects(consumeTask(f.directory, f.trusted, existing), /EEXIST/);
  await writeFile(f.sourceFile, JSON.stringify({ sha256: '0'.repeat(64), license: 'pending' }));
  const fresh = path.join(f.root, 'not-created');
  await assert.rejects(createTask({ inputFile: f.inputFile, sourceFile: f.sourceFile, outputDirectory: fresh, policy }), /snapshot hash mismatch/);
  await assert.rejects(access(fresh));
});
test('symlink artifacts cannot escape the expected folder', async t => {
  const f = await fixture(t), file = path.join(f.directory, 'original.glb');
  await rm(file); await symlink(f.inputFile, file);
  await assert.rejects(consumeTask(f.directory, f.trusted), /type|symbolic|ELOOP/i);
});

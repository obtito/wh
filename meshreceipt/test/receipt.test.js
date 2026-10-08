import test from 'node:test';
import assert from 'node:assert/strict';
import { NodeIO } from '@gltf-transform/core';
import { makeFixture } from './fixtures.js';
import { DEFAULT_POLICY, canonicalJSON, hashJSON, inspect, optimizeTexture, validatePolicy, verifyDelivery } from '../src/receipt.js';

const input = await makeFixture();
const good = await optimizeTexture(input);
const bad = await optimizeTexture(input, { fault: 'drop-animation' });

test('genuine texture optimization meets the preset policy', async () => {
  const report = await verifyDelivery(input, good);
  assert.equal(report.verdict, 'PASS');
  assert.ok(good.length < input.length);
  assert.equal(report.checks.length, 6);
});
test('transparent materials remain an explicit unverified visual-quality boundary', async () => {
  const io = new NodeIO(), document = await io.readBinary(good);
  for (const material of document.getRoot().listMaterials()) material.setAlphaMode('BLEND').setBaseColorFactor([0, 0, 0, 0]);
  const report = await verifyDelivery(input, await io.writeBinary(document));
  assert.equal(report.verdict, 'PASS');
  assert.deepEqual(report.checks.map(check => check.id), ['format', 'file-size', 'required-nodes', 'hierarchy', 'geometry', 'animation']);
});
test('deleted animation fails, despite valid format and small file', async () => {
  const report = await verifyDelivery(input, bad);
  assert.equal(report.verdict, 'FAIL');
  assert.equal(report.checks.find(c => c.id === 'format').pass, true);
  assert.equal(report.checks.find(c => c.id === 'file-size').pass, true);
  assert.equal(report.checks.find(c => c.id === 'animation').pass, false);
});
test('unchanged animation name/count cannot hide altered keyframes', async () => {
  const output = await optimizeTexture(input, { fault: 'change-keyframe' });
  const report = await verifyDelivery(input, output);
  assert.equal(report.verdict, 'FAIL');
  assert.equal(report.original.summary.animationCount, report.delivery.summary.animationCount);
  assert.equal(report.checks.find(c => c.id === 'animation').pass, false);
});
test('unsupported input is inconclusive, never passed', async () => {
  const report = await verifyDelivery(await makeFixture({ unsupported: true }), good);
  assert.equal(report.verdict, 'INCONCLUSIVE');
});
test('unsupported delivery is inconclusive', async () => {
  const report = await verifyDelivery(input, await makeFixture({ unsupported: true }));
  assert.equal(report.verdict, 'INCONCLUSIVE');
});
test('corrupt delivery fails; corrupt original is inconclusive', async () => {
  assert.equal((await verifyDelivery(input, new Uint8Array([1, 2, 3]))).verdict, 'FAIL');
  assert.equal((await verifyDelivery(new Uint8Array([1, 2, 3]), good)).verdict, 'INCONCLUSIVE');
});
test('same files/rules produce the same core report hash', async () => {
  assert.deepEqual(await verifyDelivery(input, good), await verifyDelivery(input, good));
});
test('geometry modifications fail', async () => {
  const doc = await new NodeIO().readBinary(good);
  const positions = doc.getRoot().listMeshes()[0].listPrimitives()[0].getAttribute('POSITION');
  const values = positions.getArray().slice(); values[0] += 0.1; positions.setArray(values);
  const report = await verifyDelivery(input, await new NodeIO().writeBinary(doc));
  assert.equal(report.verdict, 'FAIL');
  assert.equal(report.checks.find(c => c.id === 'geometry').pass, false);
});
test('size ceiling is enforced independently of format', async () => {
  const report = await verifyDelivery(input, good, { ...DEFAULT_POLICY, maxOutputBytes: 1 });
  assert.equal(report.verdict, 'FAIL');
  assert.equal(report.checks.find(c => c.id === 'file-size').pass, false);
});
test('policy mutation changes its commitment', async () => {
  const a = await verifyDelivery(input, good);
  const b = await verifyDelivery(input, good, { ...DEFAULT_POLICY, maxOutputBytes: 399_999 });
  assert.notEqual(a.policyHash, b.policyHash);
  assert.notEqual(a.reportHash, b.reportHash);
});
test('required nodes must exist in both versions', async () => {
  const report = await verifyDelivery(input, good, { ...DEFAULT_POLICY, requiredNodes: ['Missing'] });
  assert.equal(report.verdict, 'FAIL');
});
test('unknown policy fields, empty required checks, invalid ceilings rejected', () => {
  assert.throws(() => validatePolicy({ ...DEFAULT_POLICY, skipAnimation: true }));
  assert.throws(() => validatePolicy({ ...DEFAULT_POLICY, requiredNodes: [] }));
  assert.throws(() => validatePolicy({ ...DEFAULT_POLICY, maxOutputBytes: Infinity }));
});
test('canonical hash ignores object key order; report tampering changes hash', async () => {
  assert.equal(canonicalJSON({ b: 2, a: 1 }), canonicalJSON({ a: 1, b: 2 }));
  const { reportHash, ...core } = await verifyDelivery(input, good);
  assert.equal(hashJSON(core), reportHash);
  assert.notEqual(hashJSON({ ...core, verdict: 'FAIL' }), reportHash);
});
test('external resources are rejected before loading', async () => {
  const json = JSON.stringify({ asset: { version: '2.0' }, buffers: [{ byteLength: 1, uri: 'file:///etc/passwd' }] });
  const padded = Buffer.from(json.padEnd(Math.ceil(Buffer.byteLength(json) / 4) * 4, ' '));
  const bytes = Buffer.alloc(20 + padded.length);
  bytes.writeUInt32LE(0x46546c67, 0); bytes.writeUInt32LE(2, 4); bytes.writeUInt32LE(bytes.length, 8);
  bytes.writeUInt32LE(padded.length, 12); bytes.writeUInt32LE(0x4e4f534a, 16); padded.copy(bytes, 20);
  assert.equal((await inspect(bytes)).status, 'UNSUPPORTED');
});

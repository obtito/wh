import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { tmpdir, platform, release as osRelease } from 'node:os';
import path from 'node:path';
import { randomUUID, createHash } from 'node:crypto';
import { NodeIO } from '@gltf-transform/core';
import { consumeBundle } from '../src/bundle.js';

const output = process.argv[2];
if (!output) throw new Error('Usage: node scripts/check-handoff.js NEW_RESULT_FILE');
const evidence = new URL('../docs/evidence/', import.meta.url);
const instance = '819eea82-7664-4f53-b9cc-101982158359';
const qualifiedTrust = { issuer: '0x89b55cA3dd9F2b5ADd33A61504B3B531589D5c36', instance, providerId: 'careful-demo' };
const failedTrust = { issuer: '0xf59e678daF69F9CB023083C2E96264ae6BFb111c', instance, providerId: 'rapid-demo' };
const qualifiedPath = new URL('pavilion-qualified.json', evidence), failurePath = new URL('pavilion-failure.json', evidence);
const recipient = path.join(tmpdir(), `meshreceipt-recipient-${randomUUID()}`);
const qualified = await consumeBundle(qualifiedPath, qualifiedTrust, recipient);
const failed = await consumeBundle(failurePath, failedTrust);
if (!qualified.qualified || failed.verdict !== 'FAIL' || failed.qualified) throw new Error('Unexpected qualified/evidence result');
const glb = await readFile(path.join(recipient, 'model.glb')), model = await new NodeIO().readBinary(glb);
const altered = JSON.parse(await readFile(qualifiedPath, 'utf8'));
const changed = Buffer.from(altered.files['model.glb'], 'base64'); changed[changed.length - 1] ^= 1;
altered.files['model.glb'] = changed.toString('base64');
const tampered = path.join(tmpdir(), `meshreceipt-tampered-${randomUUID()}.json`); await writeFile(tampered, JSON.stringify(altered), { flag: 'wx' });
let refused = false;
try { await consumeBundle(tampered, qualifiedTrust); } catch (error) { refused = /integrity/.test(error.message); }
if (!refused) throw new Error('Tampered model was not rejected');
const result = { schema: 'meshreceipt.recipient-check.v1', checkedAt: new Date().toISOString(), node: process.version,
  os: `${platform()} ${osRelease()}`, qualified: qualified.verdict, failure: failed.verdict, tamperRejected: refused,
  modelHash: createHash('sha256').update(glb).digest('hex'), nodes: model.getRoot().listNodes().length,
  meshes: model.getRoot().listMeshes().length, animations: model.getRoot().listAnimations().length,
  recipientDirectory: recipient, browserOpened: false, externalComputerConfirmed: false,
  note: 'Run on the recipient computer after independently confirming identities/tool version. A local run does not prove teammate use.' };
await mkdir(path.dirname(path.resolve(output)), { recursive: true });
await writeFile(output, `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify(result, null, 2));

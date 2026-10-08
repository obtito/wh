import path from 'node:path';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { Wallet, getAddress, verifyMessage } from 'ethers';
import { canonicalJSON, hashJSON, sha256 } from '../../src/receipt.js';
import { readBoundedFile } from '../../src/bundle.js';
import { LIMITS, POLICY, packModel, unpackModel, validatePolicy, verifyTransfer } from './codec.js';

export const SCHEMA = 'meshreceipt.large-local-delivery.v1';
export const FILES = Object.freeze(['original.glb', 'model.glb.br', 'policy.json', 'report.json', 'source.json', 'delivery.json']);
const UUID = /^[\da-f]{8}-[\da-f]{4}-4[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/i;
const HASH = /^[\da-f]{64}$/;
const jsonBytes = value => Buffer.from(`${JSON.stringify(value, null, 2)}\n`);
const fileLimit = name => name === 'original.glb' ? LIMITS.inputBytes : name === 'model.glb.br' ? LIMITS.transferBytes : 512 * 1024;
function requireThat(value, reason) { if (!value) throw new Error(reason); }
function keys(value, expected, label) {
  requireThat(value && !Array.isArray(value) && typeof value === 'object'
    && Object.keys(value).sort().join(',') === [...expected].sort().join(','), `Invalid ${label} fields`);
}
function sealMessage(instance, hash) { return `${SCHEMA}:${instance}:${hash}`; }
function deliveryMessage(instance, payload) { return `${SCHEMA}/delivery:${instance}:${hashJSON(payload)}`; }
function taskCommitment(task) {
  return hashJSON({ taskId: task.id, assetId: task.assetId, createdAt: task.createdAt, inputHash: task.inputHash, policyHash: task.policyHash });
}
function payloadFor(manifest) {
  return { taskHash: manifest.task.taskHash, taskId: manifest.task.id, attemptId: manifest.attempt.id,
    providerId: manifest.provider.id, inputHash: manifest.task.inputHash, policyHash: manifest.task.policyHash,
    outputHash: manifest.attempt.outputHash, transferHash: manifest.attempt.transferHash, reportHash: manifest.attempt.reportHash };
}

/** Local artifacts only. The signing key is ephemeral, never persisted or printed. */
export async function createTask({ inputFile, sourceFile, outputDirectory, policy = POLICY, negativeControl = false }) {
  const frozen = validatePolicy(policy);
  const [input, rawSource] = await Promise.all([readBoundedFile(inputFile, frozen.maxInputBytes), readBoundedFile(sourceFile, 64 * 1024)]);
  const source = JSON.parse(rawSource.toString('utf8'));
  requireThat(source.sha256 === sha256(input), 'Source snapshot hash mismatch');
  requireThat(typeof source.license === 'string' && source.license.length > 0, 'Missing source license declaration');
  const createdAt = new Date().toISOString();
  const task = { id: randomUUID(), assetId: 'huanghe-blender-local', createdAt,
    mode: negativeControl ? 'controlled-negative-example' : 'local-service-adapter', inputHash: sha256(input), policyHash: hashJSON(frozen) };
  task.taskHash = taskCommitment(task);
  const wallet = Wallet.createRandom();
  const provider = { id: 'huanghe-lossless-local', issuer: wallet.address, instance: randomUUID(),
    provenance: 'Team-controlled local adapter; not an independently trusted provider or real AI agent run' };
  // Freeze the policy before running the operation; do not lower thresholds to make a result pass.
  const started = process.hrtime.bigint();
  const packed = await packModel(input, frozen, { controlledFault: negativeControl });
  const processingMs = Number(process.hrtime.bigint() - started) / 1e6;
  const checkingStarted = process.hrtime.bigint();
  const report = await verifyTransfer(input, packed, frozen);
  const checkingMs = Number(process.hrtime.bigint() - checkingStarted) / 1e6;
  if (!negativeControl) requireThat(report.verdict === 'PASS', `Delivery did not meet frozen policy: ${report.verdict}`);
  else requireThat(report.verdict === 'FAIL', 'Negative control was not rejected');
  const attempt = { id: randomUUID(), verdict: report.verdict, outputHash: report.outputHash,
    transferHash: report.transferHash, reportHash: report.reportHash };
  const manifest = { schema: SCHEMA, task, attempt, provider,
    rights: { redistribution: 'not-authorized', sourceLicense: source.license,
      notice: 'Local evaluation only. Model and font redistribution permissions remain unconfirmed.' }, files: {} };
  const payload = payloadFor(manifest);
  const delivery = { schema: `${SCHEMA}/delivery`, instance: provider.instance, issuer: provider.issuer,
    payload, signature: await wallet.signMessage(deliveryMessage(provider.instance, payload)) };
  const files = { 'original.glb': input, 'model.glb.br': packed, 'policy.json': jsonBytes(frozen),
    'report.json': jsonBytes(report), 'source.json': rawSource, 'delivery.json': jsonBytes(delivery) };
  for (const name of FILES) manifest.files[name] = { bytes: files[name].length, sha256: sha256(files[name]) };
  const manifestHash = hashJSON(manifest);
  const seal = { schema: `${SCHEMA}/seal`, instance: provider.instance, issuer: provider.issuer, manifestHash,
    signature: await wallet.signMessage(sealMessage(provider.instance, manifestHash)) };
  await mkdir(outputDirectory, { mode: 0o700 });
  for (const name of FILES) await writeFile(path.join(outputDirectory, name), files[name], { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(outputDirectory, 'manifest.json'), jsonBytes(manifest), { flag: 'wx', mode: 0o600 });
  await writeFile(path.join(outputDirectory, 'seal.json'), jsonBytes(seal), { flag: 'wx', mode: 0o600 });
  const execution = { schema: `${SCHEMA}/execution`, processingMs, checkingMs, peakRssKiB: process.resourceUsage().maxRSS,
    node: process.version, brotli: process.versions.brotli, outputDirectory, mainnetTransactions: 0, realAIInvocations: 0,
    note: 'Local process observations, not independently reproduced performance claims; heap cap is not an RSS cap.' };
  await writeFile(path.join(outputDirectory, 'execution.json'), jsonBytes(execution), { flag: 'wx', mode: 0o600 });
  return { taskId: task.id, attemptId: attempt.id, verdict: report.verdict, originalBytes: input.length,
    transferBytes: packed.length, reductionPercent: (1 - packed.length / input.length) * 100,
    inputHash: task.inputHash, outputHash: report.outputHash, transferHash: report.transferHash,
    reportHash: report.reportHash, manifestHash, trustedIdentity: { issuer: provider.issuer, instance: provider.instance, providerId: provider.id, inputHash: task.inputHash },
    redistributionAuthorized: false, execution };
}

/** Does not use the producer's database, original filesystem paths, keys, or HTTP server. */
export async function consumeTask(directory, trusted, outputDirectory) {
  requireThat(trusted && typeof trusted.issuer === 'string' && UUID.test(trusted.instance)
    && typeof trusted.providerId === 'string' && HASH.test(trusted.inputHash), 'Explicit trusted issuer, instance, provider ID and original input hash are required');
  const issuer = getAddress(trusted.issuer);
  const [manifestBytes, sealBytes] = await Promise.all(['manifest.json', 'seal.json'].map(n => readBoundedFile(path.join(directory, n), 512 * 1024)));
  const manifest = JSON.parse(manifestBytes), seal = JSON.parse(sealBytes);
  keys(manifest, ['schema', 'task', 'attempt', 'provider', 'rights', 'files'], 'manifest');
  keys(seal, ['schema', 'instance', 'issuer', 'manifestHash', 'signature'], 'seal');
  requireThat(manifest.schema === SCHEMA && seal.schema === `${SCHEMA}/seal`, 'Wrong delivery schema');
  keys(manifest.task, ['id', 'assetId', 'createdAt', 'mode', 'inputHash', 'policyHash', 'taskHash'], 'task');
  keys(manifest.attempt, ['id', 'verdict', 'outputHash', 'transferHash', 'reportHash'], 'attempt');
  keys(manifest.provider, ['id', 'issuer', 'instance', 'provenance'], 'provider');
  keys(manifest.rights, ['redistribution', 'sourceLicense', 'notice'], 'rights');
  requireThat(UUID.test(manifest.task.id) && UUID.test(manifest.attempt.id) && UUID.test(manifest.provider.instance)
    && manifest.task.assetId === 'huanghe-blender-local'
    && ['local-service-adapter', 'controlled-negative-example'].includes(manifest.task.mode)
    && ['PASS', 'FAIL', 'INCONCLUSIVE'].includes(manifest.attempt.verdict), 'Invalid task/attempt context');
  for (const hash of [manifest.task.inputHash, manifest.task.policyHash, manifest.task.taskHash,
    manifest.attempt.outputHash, manifest.attempt.transferHash, manifest.attempt.reportHash]) requireThat(HASH.test(hash), 'Invalid commitment');
  requireThat(manifest.task.taskHash === taskCommitment(manifest.task), 'Task commitment mismatch');
  requireThat(manifest.task.inputHash === trusted.inputHash, 'Trusted original input hash mismatch');
  requireThat(manifest.provider.id === trusted.providerId && manifest.provider.instance === trusted.instance
    && getAddress(manifest.provider.issuer) === issuer && seal.instance === trusted.instance && getAddress(seal.issuer) === issuer, 'Trusted identity mismatch');
  requireThat(seal.manifestHash === hashJSON(manifest)
    && verifyMessage(sealMessage(trusted.instance, seal.manifestHash), seal.signature) === issuer, 'Invalid manifest signature');
  requireThat(manifest.rights.redistribution === 'not-authorized', 'This experimental format cannot authorize public redistribution');
  keys(manifest.files, FILES, 'file list');
  const files = {};
  // Check all logical file entries even if the original can be reconstructed from a PASS transfer.
  for (const name of FILES) {
    const entry = manifest.files[name]; keys(entry, ['bytes', 'sha256'], 'file entry');
    requireThat(Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= fileLimit(name) && HASH.test(entry.sha256), 'Invalid file bounds');
  }
  let originalSource = 'included-original';
  for (const name of [...FILES.filter(n => n !== 'original.glb'), 'original.glb']) {
    const entry = manifest.files[name];
    try { files[name] = await readBoundedFile(path.join(directory, name), fileLimit(name)); }
    catch (error) {
      // Missing is the ONLY allowed exception, and only for a PASS declared against a separately trusted original hash.
      // Bad permissions, symlinks, oversize files and corrupted originals must never trigger a fallback.
      if (name !== 'original.glb' || error.code !== 'ENOENT' || manifest.attempt.verdict !== 'PASS') throw error;
      const frozen = validatePolicy(JSON.parse(files['policy.json']));
      files[name] = await unpackModel(files['model.glb.br'], frozen);
      requireThat(sha256(files[name]) === trusted.inputHash, 'Reconstructed original does not match trusted input');
      originalSource = 'reconstructed-from-transfer-and-trusted-hash';
    }
    requireThat(files[name].length === entry.bytes && sha256(files[name]) === entry.sha256, `File integrity mismatch: ${name}`);
  }
  const policy = validatePolicy(JSON.parse(files['policy.json'])), report = JSON.parse(files['report.json']);
  const source = JSON.parse(files['source.json']), delivery = JSON.parse(files['delivery.json']);
  requireThat(sha256(files['original.glb']) === manifest.task.inputHash && hashJSON(policy) === manifest.task.policyHash
    && source.sha256 === manifest.task.inputHash && source.license === manifest.rights.sourceLicense, 'Frozen input/policy/source mismatch');
  keys(delivery, ['schema', 'instance', 'issuer', 'payload', 'signature'], 'delivery');
  requireThat(delivery.schema === `${SCHEMA}/delivery` && delivery.instance === trusted.instance && getAddress(delivery.issuer) === issuer
    && canonicalJSON(delivery.payload) === canonicalJSON(payloadFor(manifest))
    && verifyMessage(deliveryMessage(trusted.instance, delivery.payload), delivery.signature) === issuer, 'Invalid delivery signature');
  const { reportHash, ...core } = report;
  requireThat(reportHash === hashJSON(core) && reportHash === manifest.attempt.reportHash, 'Report commitment mismatch');
  const recomputed = await verifyTransfer(files['original.glb'], files['model.glb.br'], policy);
  requireThat(recomputed.reportHash === reportHash && recomputed.verdict === manifest.attempt.verdict
    && recomputed.outputHash === manifest.attempt.outputHash && recomputed.transferHash === manifest.attempt.transferHash, 'Independent recomputation mismatch');
  const result = { schema: SCHEMA, taskId: manifest.task.id, attemptId: manifest.attempt.id, verdict: recomputed.verdict,
    integrity: true, signatureValid: true, recomputed: true, outputHash: recomputed.outputHash, transferHash: recomputed.transferHash,
    reportHash, byteIdentical: recomputed.restored.byteIdentical, originalSource, redistributionAuthorized: false,
    note: 'Technical acceptance of lossless transfer only; not real AI, on-chain proof, visual accuracy or redistribution authorization.' };
  if (outputDirectory) {
    requireThat(result.verdict === 'PASS', 'Only PASS may be extracted as a usable model');
    const model = await unpackModel(files['model.glb.br'], policy);
    await mkdir(outputDirectory, { mode: 0o700 });
    await writeFile(path.join(outputDirectory, 'model.glb'), model, { flag: 'wx', mode: 0o600 });
    for (const [name, bytes] of Object.entries(files)) if (name !== 'original.glb') await writeFile(path.join(outputDirectory, name), bytes, { flag: 'wx', mode: 0o600 });
    for (const [name, bytes] of [['manifest.json', manifestBytes], ['seal.json', sealBytes], ['verification.json', jsonBytes(result)]]) {
      await writeFile(path.join(outputDirectory, name), bytes, { flag: 'wx', mode: 0o600 });
    }
  }
  return result;
}

/** A compact local transfer: original file omitted, but still committed in the signed manifest. */
export async function exportTransport(directory, trusted, outputDirectory) {
  const checked = await consumeTask(directory, trusted);
  requireThat(checked.verdict === 'PASS', 'Only PASS supports compact transport export');
  const bytes = {};
  for (const name of [...FILES.filter(n => n !== 'original.glb'), 'manifest.json', 'seal.json']) {
    bytes[name] = await readBoundedFile(path.join(directory, name), fileLimit(name));
  }
  await mkdir(outputDirectory, { mode: 0o700 });
  for (const [name, value] of Object.entries(bytes)) await writeFile(path.join(outputDirectory, name), value, { flag: 'wx', mode: 0o600 });
  const verified = await consumeTask(outputDirectory, trusted);
  return { ...verified, transferDirectory: outputDirectory, totalTransportBytes: Object.values(bytes).reduce((n, b) => n + b.length, 0),
    originalFileOmitted: true, note: 'Local-only transport. Requires independently confirmed original hash; no public distribution authorization.' };
}

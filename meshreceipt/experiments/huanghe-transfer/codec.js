import { readFile } from 'node:fs/promises';
import { promisify } from 'node:util';
import { brotliCompress, brotliDecompress, constants } from 'node:zlib';
import validator from 'gltf-validator';
import { hashJSON, sha256 } from '../../src/receipt.js';

// Separate profile: these limits do NOT change the original texture-only pipeline.
export const LIMITS = Object.freeze({ inputBytes: 32 * 1024 * 1024, transferBytes: 16 * 1024 * 1024,
  jsonBytes: 2 * 1024 * 1024, nodes: 500, meshes: 500, triangles: 2_000_000, accessorElements: 12_000_000 });
export const POLICY = Object.freeze({ version: 'meshreceipt.lossless-transfer.v1', encoding: 'br',
  brotliQuality: 4, maxInputBytes: LIMITS.inputBytes, maxTransferBytes: LIMITS.transferBytes,
  minReductionBps: 2000, requiredNodes: Object.freeze(['00_Base/Terrace', '01_Roof/Glazed roof planes']) });
const compress = promisify(brotliCompress), decompress = promisify(brotliDecompress);
const policyKeys = Object.keys(POLICY).sort().join(',');

export function validatePolicy(policy = POLICY) {
  if (!policy || Array.isArray(policy) || Object.keys(policy).sort().join(',') !== policyKeys
    || policy.version !== POLICY.version || policy.encoding !== 'br' || policy.brotliQuality !== 4) throw new Error('Unknown lossless-transfer policy');
  for (const [field, maximum] of [['maxInputBytes', LIMITS.inputBytes], ['maxTransferBytes', LIMITS.transferBytes]]) {
    if (!Number.isSafeInteger(policy[field]) || policy[field] < 20 || policy[field] > maximum) throw new Error(`Invalid ${field}`);
  }
  if (!Number.isSafeInteger(policy.minReductionBps) || policy.minReductionBps < 1 || policy.minReductionBps > 9900) throw new Error('Invalid reduction threshold');
  if (!Array.isArray(policy.requiredNodes) || !policy.requiredNodes.length || policy.requiredNodes.length > LIMITS.nodes
    || policy.requiredNodes.some(n => typeof n !== 'string' || !n.length || n.length > 128)
    || new Set(policy.requiredNodes).size !== policy.requiredNodes.length) throw new Error('Invalid required nodes');
  return JSON.parse(JSON.stringify(policy));
}

function header(bytes, maximum) {
  if (!(bytes instanceof Uint8Array) || bytes.length < 20 || bytes.length > maximum) throw new Error('Input outside supported byte bounds');
  const b = Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (b.readUInt32LE(0) !== 0x46546c67 || b.readUInt32LE(4) !== 2 || b.readUInt32LE(8) !== b.length
    || b.readUInt32LE(16) !== 0x4e4f534a) throw new Error('Invalid GLB 2.0 header');
  const size = b.readUInt32LE(12);
  if (size > LIMITS.jsonBytes || size > b.length - 20 || size % 4) throw new Error('GLB JSON bounds exceeded');
  const json = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(b.subarray(20, 20 + size)));
  if (!json || Array.isArray(json) || typeof json !== 'object') throw new Error('Invalid glTF JSON');
  return json;
}

export async function inspectModel(bytes, policy = POLICY) {
  const frozen = validatePolicy(policy);
  let json;
  try { json = header(bytes, frozen.maxInputBytes); } catch (error) { return { status: 'INVALID', reason: error.message }; }
  try {
    for (const key of ['nodes', 'meshes', 'accessors', 'materials', 'buffers', 'images', 'textures', 'animations', 'skins', 'cameras']) {
      if (json[key] !== undefined && !Array.isArray(json[key])) throw new Error(`Invalid ${key}`);
    }
    const unsupported = reason => ({ status: 'UNSUPPORTED', reason });
    if ((json.extensionsUsed?.length ?? 0) || (json.extensionsRequired?.length ?? 0)) return unsupported('Extensions are unsupported in this profile');
    if ((json.buffers ?? []).some(b => Object.hasOwn(b, 'uri')) || (json.images ?? []).some(i => Object.hasOwn(i, 'uri'))) return unsupported('External resources are disabled');
    if ((json.images?.length ?? 0) || (json.textures?.length ?? 0) || (json.animations?.length ?? 0)
      || (json.skins?.length ?? 0) || (json.cameras?.length ?? 0)) return unsupported('Only untextured static GLB is supported');
    if ((json.nodes?.length ?? 0) > LIMITS.nodes || (json.meshes?.length ?? 0) > LIMITS.meshes) return unsupported('Node/mesh limit exceeded');
    if ((json.accessors?.length ?? 0) > 4096) return unsupported('Accessor limit exceeded');
    const widths = { SCALAR: 1, VEC2: 2, VEC3: 3, VEC4: 4, MAT2: 4, MAT3: 9, MAT4: 16 };
    let elements = 0, triangles = 0;
    for (const a of json.accessors ?? []) {
      if (!Number.isSafeInteger(a.count) || a.count < 1 || !widths[a.type]) throw new Error('Invalid accessor count/type');
      if (a.sparse) return unsupported('Sparse accessors are unsupported');
      elements += a.count * widths[a.type];
      if (elements > LIMITS.accessorElements) return unsupported('Decoded accessor element limit exceeded');
    }
    for (const group of [json.nodes ?? [], json.meshes ?? []]) {
      if (group.some(n => typeof n.name !== 'string' || !n.name.length || n.name.length > 128)
        || new Set(group.map(n => n.name)).size !== group.length) return unsupported('Unique node/mesh names are required');
    }
    for (const mesh of json.meshes ?? []) for (const primitive of mesh.primitives ?? []) {
      if ((primitive.mode ?? 4) !== 4 || primitive.targets?.length) return unsupported('Only triangles without morph targets are supported');
      const accessor = primitive.indices !== undefined ? json.accessors?.[primitive.indices] : json.accessors?.[primitive.attributes?.POSITION];
      if (!accessor || accessor.count % 3) throw new Error('Invalid triangle accessor');
      triangles += accessor.count / 3;
      if (triangles > LIMITS.triangles) return unsupported('Triangle limit exceeded');
    }
    const result = await validator.validateBytes(bytes, { maxIssues: 100, writeTimestamp: false,
      externalResourceFunction: () => Promise.reject(new Error('External resources are disabled')) });
    if (result.issues.numErrors) return { status: 'INVALID', reason: 'glTF specification errors', errors: result.issues.numErrors };
    return { status: 'VALID', summary: { nodes: (json.nodes ?? []).map(n => n.name).sort(),
      nodeCount: json.nodes?.length ?? 0, meshCount: json.meshes?.length ?? 0, triangles,
      materialCount: json.materials?.length ?? 0, textureCount: 0, animationCount: 0 }, warnings: result.issues.numWarnings };
  } catch (error) { return { status: 'INVALID', reason: error.message }; }
}

export async function packModel(input, policy = POLICY, { controlledFault = false } = {}) {
  const frozen = validatePolicy(policy), inspected = await inspectModel(input, frozen);
  if (inspected.status !== 'VALID') throw new Error(`Cannot pack: ${inspected.status}: ${inspected.reason}`);
  let data = input;
  if (controlledFault) {
    data = Buffer.from(input);
    const binStart = 20 + data.readUInt32LE(12);
    if (binStart + 8 >= data.length || data.readUInt32LE(binStart + 4) !== 0x004e4942) throw new Error('Missing BIN chunk for negative control');
    data[binStart + 8] ^= 1;
  }
  return Buffer.from(await compress(data, { maxOutputLength: LIMITS.inputBytes,
    params: { [constants.BROTLI_PARAM_QUALITY]: frozen.brotliQuality,
      [constants.BROTLI_PARAM_LGWIN]: 22, [constants.BROTLI_PARAM_SIZE_HINT]: input.length } }));
}

export async function unpackModel(transfer, policy = POLICY) {
  const frozen = validatePolicy(policy);
  if (!(transfer instanceof Uint8Array) || !transfer.length || transfer.length > frozen.maxTransferBytes) throw new Error('Transfer outside supported byte bounds');
  const decoded = await decompress(transfer, { maxOutputLength: frozen.maxInputBytes, info: true });
  // Node 22+ supports info. Explicit consumed-byte checking also rejects appended garbage.
  if (decoded.engine.bytesWritten !== transfer.length) throw new Error('Trailing bytes after Brotli stream');
  return Buffer.from(decoded.buffer);
}

export async function verifyTransfer(input, transfer, policy = POLICY) {
  const frozen = validatePolicy(policy);
  if (!(input instanceof Uint8Array) || !(transfer instanceof Uint8Array)
    || input.length > LIMITS.inputBytes || transfer.length > LIMITS.inputBytes) throw new Error('Verification input exceeds hard bounds');
  const original = await inspectModel(input, frozen);
  let restored = null, reason = null;
  try { restored = await unpackModel(transfer, frozen); } catch (error) { reason = error.message; }
  const same = restored !== null && input.length === restored.length && Buffer.from(input).equals(restored);
  const checks = [
    { id: 'source-format', pass: original.status === 'VALID' },
    { id: 'transfer-size', pass: transfer.length > 0 && transfer.length <= frozen.maxTransferBytes,
      actual: transfer.length, maximum: frozen.maxTransferBytes },
    { id: 'minimum-reduction', pass: transfer.length * 10000 <= input.length * (10000 - frozen.minReductionBps), minimumBps: frozen.minReductionBps },
    { id: 'bounded-decompression', pass: restored !== null, reason },
    { id: 'byte-identical-model', pass: same },
    { id: 'required-nodes', pass: same && frozen.requiredNodes.every(n => original.summary?.nodes.includes(n)) },
  ];
  const pkg = JSON.parse(await readFile(new URL('../../node_modules/gltf-validator/package.json', import.meta.url), 'utf8'));
  const core = { spec: 'meshreceipt.lossless-transfer.receipt.v1', policy: frozen, policyHash: hashJSON(frozen),
    inputHash: sha256(input), outputHash: restored ? sha256(restored) : null, transferHash: sha256(transfer),
    verdict: original.status !== 'VALID' ? 'INCONCLUSIVE' : checks.every(c => c.pass) ? 'PASS' : 'FAIL', checks,
    original: { bytes: input.length, ...original }, transfer: { bytes: transfer.length, encoding: 'br' },
    restored: { bytes: restored?.length ?? null, byteIdentical: same },
    tools: { verifier: 'meshreceipt/lossless-transfer/0.1.0', 'gltf-validator': pkg.version },
    scope: 'Lossless delivery compression only; no geometric simplification, visual accuracy or rights certification' };
  return { ...core, reportHash: hashJSON(core) };
}

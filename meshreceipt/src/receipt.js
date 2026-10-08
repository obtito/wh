import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { NodeIO } from '@gltf-transform/core';
import validator from 'gltf-validator';
import sharp from 'sharp';

export const LIMITS = Object.freeze({ bytes: 10 * 1024 * 1024, pixels: 16_777_216, nodes: 500 });
export const DEFAULT_POLICY = Object.freeze({
  version: 'meshreceipt.texture-only.v1',
  maxOutputBytes: 400_000,
  requiredNodes: ['Asset'],
});

export function canonicalJSON(value) {
  if (Array.isArray(value)) return `[${value.map(canonicalJSON).join(',')}]`;
  if (value !== null && typeof value === 'object') {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalJSON(value[key])}`).join(',')}}`;
  }
  if (typeof value === 'number' && !Number.isFinite(value)) throw new Error('Non-finite number');
  const result = JSON.stringify(value);
  if (result === undefined) throw new Error('Unsupported JSON value');
  return result;
}

export function sha256(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

export function hashJSON(value) {
  return sha256(canonicalJSON(value));
}

export function validatePolicy(policy) {
  if (!policy || Array.isArray(policy) || typeof policy !== 'object') throw new Error('Policy must be an object');
  const fields = Object.keys(policy).sort().join(',');
  if (fields !== 'maxOutputBytes,requiredNodes,version' || policy.version !== DEFAULT_POLICY.version) {
    throw new Error('Unknown policy fields or version');
  }
  if (!Number.isSafeInteger(policy.maxOutputBytes) || policy.maxOutputBytes < 1 || policy.maxOutputBytes > LIMITS.bytes) {
    throw new Error('maxOutputBytes must be an integer between 1 and 10 MiB');
  }
  if (!Array.isArray(policy.requiredNodes) || !policy.requiredNodes.length || policy.requiredNodes.length > LIMITS.nodes
    || policy.requiredNodes.some(name => typeof name !== 'string' || !name.length || name.length > 128)
    || new Set(policy.requiredNodes).size !== policy.requiredNodes.length) {
    throw new Error('requiredNodes must contain unique, non-empty names');
  }
  return JSON.parse(canonicalJSON(policy));
}

function preflight(bytes) {
  if (!(bytes instanceof Uint8Array)) throw new Error('Expected bytes');
  if (bytes.length > LIMITS.bytes || bytes.length < 20) throw new Error('File size outside supported bounds');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  if (view.getUint32(0, true) !== 0x46546c67 || view.getUint32(4, true) !== 2
    || view.getUint32(8, true) !== bytes.length || view.getUint32(16, true) !== 0x4e4f534a) {
    throw new Error('Invalid GLB 2.0 header');
  }
  const length = view.getUint32(12, true);
  if (length > bytes.length - 20) throw new Error('Invalid JSON chunk length');
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes.subarray(20, 20 + length)));
}

function unsupportedReason(json) {
  if ((json.extensionsUsed?.length ?? 0) || (json.extensionsRequired?.length ?? 0)) return 'Extensions are not supported in v1';
  if ((json.buffers ?? []).some(buffer => Object.hasOwn(buffer, 'uri'))
    || (json.images ?? []).some(image => Object.hasOwn(image, 'uri'))) return 'External/data URIs are not supported';
  if ((json.images ?? []).some(image => !['image/png', 'image/jpeg'].includes(image.mimeType))) return 'Only embedded PNG/JPEG textures are supported';
  if ((json.skins?.length ?? 0) || (json.cameras?.length ?? 0)) return 'Skins and cameras are not supported in v1';
  if ((json.accessors ?? []).some(accessor => accessor.sparse)) return 'Sparse accessors are not supported in v1';
  if ((json.nodes?.length ?? 0) > LIMITS.nodes) return 'Node limit exceeded';
  const groups = [json.nodes ?? [], json.meshes ?? [], json.animations ?? []];
  for (const group of groups) {
    if (group.some(item => typeof item.name !== 'string' || !item.name.length || item.name.length > 128)
      || new Set(group.map(item => item.name)).size !== group.length) return 'Nodes, meshes and animations require unique names in v1';
  }
  for (const mesh of json.meshes ?? []) {
    if ((mesh.primitives ?? []).some(p => (p.targets?.length ?? 0) || (p.mode ?? 4) !== 4)) return 'Only triangle primitives without morph targets are supported';
  }
  for (const animation of json.animations ?? []) {
    if ((animation.channels ?? []).some(c => !['translation', 'rotation', 'scale'].includes(c.target?.path))) return 'Only TRS animation is supported';
    if ((animation.samplers ?? []).some(s => !['LINEAR', 'STEP'].includes(s.interpolation ?? 'LINEAR'))) return 'Only LINEAR/STEP animation is supported';
  }
  return null;
}

function arrayData(accessor) {
  const array = accessor?.getArray();
  if (!array) throw new Error('Missing decoded accessor');
  return { type: accessor.getType(), normalized: accessor.getNormalized(), values: Array.from(array) };
}

function manifests(document) {
  const root = document.getRoot();
  const nodes = root.listNodes().map(node => ({
    name: node.getName(), mesh: node.getMesh()?.getName() ?? null,
    children: node.listChildren().map(child => child.getName()).sort(),
    translation: Array.from(node.getTranslation()), rotation: Array.from(node.getRotation()), scale: Array.from(node.getScale()),
  })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const scenes = root.listScenes().map(scene => scene.listChildren().map(node => node.getName()).sort())
    .sort((a, b) => canonicalJSON(a).localeCompare(canonicalJSON(b), 'en'));
  const geometry = root.listMeshes().map(mesh => ({ name: mesh.getName(), primitives: mesh.listPrimitives().map(p => ({
    mode: p.getMode(), indices: p.getIndices() ? arrayData(p.getIndices()) : null,
    attributes: Object.fromEntries(p.listSemantics().sort().map(semantic => [semantic, arrayData(p.getAttribute(semantic))])),
  })) })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const animations = root.listAnimations().map(animation => ({
    name: animation.getName(), channels: animation.listChannels().map(channel => {
      const sampler = channel.getSampler();
      return {
        target: channel.getTargetNode()?.getName(), path: channel.getTargetPath(), interpolation: sampler.getInterpolation(),
        time: arrayData(sampler.getInput()), values: arrayData(sampler.getOutput()),
      };
    }).sort((a, b) => canonicalJSON(a).localeCompare(canonicalJSON(b), 'en')),
  })).sort((a, b) => a.name.localeCompare(b.name, 'en'));
  const defaultScene = root.getDefaultScene()?.listChildren().map(node => node.getName()).sort() ?? null;
  return { nodes: nodes.map(node => node.name), hierarchyHash: hashJSON({ nodes, scenes, defaultScene }), geometryHash: hashJSON(geometry), animationHash: hashJSON(animations), animationCount: animations.length };
}

export async function inspect(bytes) {
  let json;
  try { json = preflight(bytes); }
  catch (error) { return { status: 'INVALID', reason: error.message }; }
  let reason;
  try {
    if (!json || Array.isArray(json) || typeof json !== 'object') throw new Error('Invalid glTF JSON object');
    reason = unsupportedReason(json);
  } catch (error) { return { status: 'INVALID', reason: error.message }; }
  if (reason) return { status: 'UNSUPPORTED', reason };
  try {
    const report = await validator.validateBytes(bytes, {
      maxIssues: 200, writeTimestamp: false,
      externalResourceFunction: () => Promise.reject(new Error('External resource loading is disabled')),
    });
    if (report.issues.numErrors > 0) return { status: 'INVALID', reason: 'glTF specification errors', errors: report.issues.numErrors };
    const document = await new NodeIO().readBinary(bytes);
    return { status: 'VALID', document, summary: manifests(document), warnings: report.issues.numWarnings };
  } catch (error) { return { status: 'INVALID', reason: error.message }; }
}

async function toolVersions() {
  const names = ['@gltf-transform/core', 'gltf-validator'];
  return Object.fromEntries(await Promise.all(names.map(async name => {
    const pkg = JSON.parse(await readFile(new URL(`../node_modules/${name}/package.json`, import.meta.url), 'utf8'));
    return [name, pkg.version];
  })));
}

export async function verifyDelivery(input, output, policy = DEFAULT_POLICY) {
  const frozenPolicy = validatePolicy(policy);
  const tools = await toolVersions();
  const base = {
    spec: 'meshreceipt.receipt.v1', inputHash: sha256(input), outputHash: sha256(output),
    policy: frozenPolicy, policyHash: hashJSON(frozenPolicy), tools: { verifier: 'meshreceipt/0.1.0', ...tools },
  };
  const original = await inspect(input);
  const delivery = await inspect(output);
  let verdict;
  let checks = [];
  if (original.status !== 'VALID') verdict = 'INCONCLUSIVE';
  else if (delivery.status === 'UNSUPPORTED') verdict = 'INCONCLUSIVE';
  else if (delivery.status === 'INVALID') {
    verdict = 'FAIL'; checks = [{ id: 'format', pass: false, reason: delivery.reason }];
  } else {
    checks = [
      { id: 'format', pass: true },
      { id: 'file-size', pass: output.length <= frozenPolicy.maxOutputBytes, actual: output.length, maximum: frozenPolicy.maxOutputBytes },
      { id: 'required-nodes', pass: frozenPolicy.requiredNodes.every(name => original.summary.nodes.includes(name) && delivery.summary.nodes.includes(name)) },
      { id: 'hierarchy', pass: original.summary.hierarchyHash === delivery.summary.hierarchyHash },
      { id: 'geometry', pass: original.summary.geometryHash === delivery.summary.geometryHash },
      { id: 'animation', pass: original.summary.animationHash === delivery.summary.animationHash },
    ];
    verdict = checks.every(check => check.pass) ? 'PASS' : 'FAIL';
  }
  const core = { ...base, verdict, checks,
    original: { status: original.status, reason: original.reason ?? null, bytes: input.length, summary: original.summary ?? null },
    delivery: { status: delivery.status, reason: delivery.reason ?? null, bytes: output.length, summary: delivery.summary ?? null },
  };
  return { ...core, reportHash: hashJSON(core) };
}

/** Deliberately narrow pipeline: embedded PNG/JPEG resize, no mesh/animation transforms. */
export async function optimizeTexture(input, { maxDimension = 256, fault = null } = {}) {
  if (!Number.isSafeInteger(maxDimension) || maxDimension < 32 || maxDimension > 2048) throw new Error('Invalid texture dimension');
  if (![null, 'drop-animation', 'change-keyframe'].includes(fault)) throw new Error('Unknown fault injection');
  const result = await inspect(input);
  if (result.status !== 'VALID') throw new Error(`Cannot optimize: ${result.status}: ${result.reason}`);
  const document = result.document;
  for (const texture of document.getRoot().listTextures()) {
    const image = texture.getImage();
    if (!image) throw new Error('Missing embedded image');
    const pipeline = sharp(image, { limitInputPixels: LIMITS.pixels, failOn: 'warning' })
      .resize({ width: maxDimension, height: maxDimension, fit: 'inside', withoutEnlargement: true });
    const encoded = texture.getMimeType() === 'image/jpeg'
      ? await pipeline.jpeg({ quality: 85 }).toBuffer()
      : await pipeline.png().toBuffer();
    texture.setImage(new Uint8Array(encoded));
  }
  if (fault === 'drop-animation') {
    for (const animation of [...document.getRoot().listAnimations()]) animation.dispose();
  }
  if (fault === 'change-keyframe') {
    const sampler = document.getRoot().listAnimations()[0]?.listSamplers()[0];
    if (!sampler) throw new Error('No animation to change');
    const values = sampler.getOutput().getArray().slice();
    values[values.length - 3] += 0.25;
    sampler.getOutput().setArray(values);
  }
  return new NodeIO().writeBinary(document);
}

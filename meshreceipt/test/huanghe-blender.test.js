import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { GLTFLoader } from 'three/addons/loaders/GLTFLoader.js';
import { validateBytes } from 'gltf-validator';
import { huangheVersion, wuhanModelUrl, wuhanModelPath } from '../public/previews/wuhan-data.js';
import { normalizePreviewModel } from '../public/previews/model-space.js';

const modelFile = new URL('../public/previews/models/huanghe-blender/refined.glb', import.meta.url);

test('Blender snapshot matches the latest delivered GLB and has no external dependencies', async () => {
  const bytes = await readFile(modelFile);
  const source = JSON.parse(await readFile(new URL('../public/previews/models/huanghe-blender/source.json', import.meta.url), 'utf8'));
  assert.equal(bytes.length, source.bytes);
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
  assert.equal(bytes.readUInt32LE(0), 0x46546c67); assert.equal(bytes.readUInt32LE(4), 2);
  assert.equal(bytes.readUInt32LE(8), bytes.length);
  const model = JSON.parse(bytes.subarray(20, 20 + bytes.readUInt32LE(12)).toString());
  assert.match(model.asset.generator, /Blender/); assert.equal(model.scenes[0].extras.stage, 'final');
  assert.equal(model.meshes.length, source.meshCount);
  assert.ok([...model.buffers, ...(model.images || [])].every(resource => !resource.uri));
  const report = await validateBytes(new Uint8Array(bytes), { maxIssues: 10 });
  assert.equal(report.issues.numErrors, 0); assert.equal(report.issues.numWarnings, 0);
  const item = huangheVersion('blender-refined');
  assert.equal(wuhanModelUrl(item), source.modelUrl); assert.equal(item.presentation, undefined);
  assert.throws(() => wuhanModelPath(item), /项目内快照/);
  assert.match(item.description, /非测绘复原/); assert.match(source.license, /不能沿用/);
});

test('real Blender export keeps native scale, materials, lettering and ground placement', async () => {
  const bytes = await readFile(modelFile), buffer = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
  const { scene } = await new GLTFLoader().parseAsync(buffer, '');
  const item = huangheVersion('blender-refined'), before = new THREE.Box3().setFromObject(scene);
  assert.ok(Math.abs(before.max.y - item.displayHeight) < 0.001);
  const meshes = [], palette = new Set(); let frontPlaque;
  scene.traverse(mesh => {
    if (!mesh.isMesh) return;
    assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
    meshes.push({ mesh, geometry: mesh.geometry, material: mesh.material });
    for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) palette.add(material.name);
    if (mesh.name.includes('樓鶴黃')) frontPlaque = mesh;
  });
  assert.equal(meshes.length, 358); assert.ok(frontPlaque);
  for (const name of ['橙赭琉璃瓦', '赭红木作', '铜色宝顶', '独立展示台']) assert.ok(palette.has(name));
  const display = normalizePreviewModel(scene, item), after = new THREE.Box3().setFromObject(display);
  assert.deepEqual(scene.scale.toArray(), [1, 1, 1]);
  assert.ok(Math.abs(after.min.y) < 1e-6); assert.ok(Math.abs(after.max.y - before.max.y) < 0.001);
  assert.ok(Math.abs(after.min.x + after.max.x) < 1e-6 && Math.abs(after.min.z + after.max.z) < 1e-6);
  assert.ok(frontPlaque.getWorldPosition(new THREE.Vector3()).z < 0);
  for (const { mesh, geometry, material } of meshes) { assert.equal(mesh.geometry, geometry); assert.equal(mesh.material, material); }
  assert.equal(display.getObjectByName('gta-wh-display-revision'), undefined);
});

test('legacy exhibition normalization remains proportional without rewriting mesh data', () => {
  const root = new THREE.Group(), geometry = new THREE.BoxGeometry(20, 10, 20);
  const mesh = new THREE.Mesh(geometry); root.add(mesh);
  const display = normalizePreviewModel(root, { displayHeight: 51.4 });
  const box = new THREE.Box3().setFromObject(display);
  assert.ok(Math.abs(box.max.y - 51.4) < 0.001 && Math.abs(box.min.y) < 1e-6);
  assert.deepEqual(root.scale.toArray(), [5.14, 5.14, 5.14]);
  assert.equal(mesh.geometry, geometry);
  assert.throws(() => normalizePreviewModel(new THREE.Group(), { displayHeight: 51.4 }), /包围盒无效/);
});

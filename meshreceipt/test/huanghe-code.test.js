import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import * as THREE from 'three';
import { buildYellowCraneTower } from '../public/previews/models/huanghe-code/tower.js';
import { HUANGHE, wuhanModelPath } from '../public/previews/wuhan-data.js';

test('bundled tower is the pinned stage-3 code snapshot, not the old GLB', async () => {
  const bytes = await readFile(new URL('../public/previews/models/huanghe-code/tower.js', import.meta.url));
  const source = JSON.parse(await readFile(new URL('../public/previews/models/huanghe-code/source.json', import.meta.url), 'utf8'));
  assert.equal(createHash('sha256').update(bytes).digest('hex'), source.sha256);
  assert.equal(HUANGHE.kind, 'procedural'); assert.equal(HUANGHE.stage, 3);
  assert.equal(HUANGHE.revision, source.revision); assert.equal(HUANGHE.stage, source.stage);
  assert.throws(() => wuhanModelPath(HUANGHE), /没有 GLB/);
  assert.doesNotMatch(bytes.toString('utf8'), /loadGLB|TextureLoader|fetch\(/);
  const viewer = await readFile(new URL('../public/previews/wuhan.js', import.meta.url), 'utf8');
  assert.match(viewer, /buildYellowCraneTower\(\{ stage: item.stage \}\)/);
  assert.doesNotMatch(viewer, /huanghe-main-tower|colorYellow/);
});

test('stage-3 tower preserves five roofs, semantic storeys, authored colors and instance batching', () => {
  const root = buildYellowCraneTower({ stage: HUANGHE.stage });
  const bounds = new THREE.Box3().setFromObject(root);
  assert.ok(Math.abs(bounds.min.y) < 1e-5 && Math.abs(bounds.max.y - 51.4) < 0.001);
  assert.equal(root.userData.revision, HUANGHE.revision); assert.equal(root.userData.cardinalGables, 20);
  assert.equal(root.getObjectByName('storeys').children.length, 5);
  assert.equal(root.getObjectByName('roof-assembly').children.filter(part => part.userData.primaryRoof).length, 5);
  let triangles = 0, draws = 0, instances = 0;
  root.traverse(mesh => {
    if (!mesh.isMesh) return;
    assert.ok(mesh.geometry.attributes.position.array.every(Number.isFinite));
    assert.ok(mesh.geometry.attributes.normal.array.every(Number.isFinite));
    assert.equal(mesh.material.vertexColors, false); assert.equal(mesh.material.map, null);
    if (mesh.isInstancedMesh) { instances++; assert.ok(mesh.instanceMatrix.array.every(Number.isFinite)); }
    draws++; triangles += (mesh.geometry.index?.count || mesh.geometry.attributes.position.count) / 3 * (mesh.isInstancedMesh ? mesh.count : 1);
  });
  // The browser adds two Canvas-text plaques (24 triangles) to this geometry.
  assert.equal(triangles, 109536); assert.ok(draws < 180); assert.ok(instances > 10);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { HUANGHE_VERSIONS, huangheVersion, wuhanModelPath } from '../public/previews/wuhan-data.js';
import { applyLatestPresentation } from '../public/previews/models/huanghe-glb/presentation.js';

test('latest GLB presentation is the default; source versions are explicit and invalid IDs fail', () => {
  assert.equal(huangheVersion().id, 'glb-latest');
  assert.equal(new Set(HUANGHE_VERSIONS.map(item => item.id)).size, 4);
  assert.equal(wuhanModelPath(huangheVersion('glb-latest')), wuhanModelPath(huangheVersion('glb-original')));
  assert.equal(huangheVersion('code-stage3').kind, 'procedural');
  assert.throws(() => huangheVersion('unknown'), /未知黄鹤楼模型版本/);
  assert.throws(() => huangheVersion(''), /未知黄鹤楼模型版本/);
});

test('presentation clones materials, preserves mesh data and places extras after base normalization', () => {
  const building = new THREE.Group(), geometry = new THREE.BoxGeometry(20, 51.4, 20);
  const roof = new THREE.MeshStandardMaterial({ color: '#718090', metalness: 0.5, vertexColors: true }); roof.name = 'Material #25';
  const red = new THREE.MeshStandardMaterial({ color: '#718090' }); red.name = 'column-008';
  const stone = new THREE.MeshStandardMaterial({ color: '#9c9c95' }); stone.name = 'foundation';
  const mesh = new THREE.Mesh(geometry, [roof, red, stone]); mesh.position.y = 25.7; building.add(mesh);
  const positions = geometry.attributes.position.array.slice(), originalRoofColor = roof.color.clone();
  const originalBounds = new THREE.Box3().setFromObject(building);
  let drawnText;
  const createCanvas = () => ({ getContext: () => ({
    fillRect() {}, strokeRect() {}, fillText(text) { drawnText = text; },
  }) });
  const extras = applyLatestPresentation(building, { createCanvas });
  assert.equal(mesh.geometry, geometry); assert.deepEqual(geometry.attributes.position.array, positions);
  assert.ok(new THREE.Box3().setFromObject(building).equals(originalBounds));
  assert.ok(roof.color.equals(originalRoofColor)); assert.equal(roof.vertexColors, true);
  assert.notEqual(mesh.material[0], roof); assert.equal(mesh.material[0].color.getHexString(), 'a87330');
  assert.equal(mesh.material[0].roughness, 0.78); assert.equal(mesh.material[0].metalness, 0);
  assert.equal(mesh.material[0].vertexColors, false); assert.equal(mesh.material[1].color.getHexString(), 'a74432');
  assert.ok(mesh.material[2].color.equals(stone.color));
  assert.equal(drawnText, '黄鹤楼');
  const finial = extras.getObjectByName('gta-wh-gourd-finial'), plaque = extras.getObjectByName('gta-wh-huanghe-plaque');
  assert.equal(finial.children.length, 3); assert.equal(finial.position.y, originalBounds.max.y - 0.7);
  assert.equal(plaque.position.y, originalBounds.min.y + 43.5); assert.equal(plaque.position.z, -9.6);
  const scene = new THREE.Group(); scene.add(building, extras);
  assert.ok(new THREE.Box3().setFromObject(scene).max.y > originalBounds.max.y);
  assert.equal(building.scale.y, 1); // Do not shrink the 51.4 m base to include extras.
});

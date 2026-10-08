import test from 'node:test';
import assert from 'node:assert/strict';
import * as THREE from 'three';
import { wuhanCoverFrame } from '../public/previews/wuhan-framing.js';

function projectFrame(size, asset, width, height, angle = 'cover') {
  const frame = wuhanCoverFrame({ size, asset, width, height, angle });
  const camera = new THREE.PerspectiveCamera(38, width / height, 0.1, 20000);
  camera.position.set(frame.direction.x, frame.direction.y, frame.direction.z).multiplyScalar(frame.distance);
  camera.lookAt(0, 0, 0);
  camera.setViewOffset(width, height, frame.offsetX, frame.offsetY, width, height);
  camera.updateMatrixWorld();
  const points = [];
  for (const x of [-size.x / 2, size.x / 2]) for (const y of [-size.y / 2, size.y / 2]) for (const z of [-size.z / 2, size.z / 2]) {
    const p = new THREE.Vector3(x, y, z).project(camera);
    const px = (p.x + 1) * width / 2, py = (1 - p.y) * height / 2;
    assert.ok(p.z >= -1 && p.z <= 1);
    assert.ok(px >= frame.side && px <= width - frame.side, `${asset}/${angle}: x=${px}`);
    assert.ok(py >= frame.top && py <= height - frame.bottom, `${asset}/${angle}: y=${py}`);
    points.push({ x: px, y: py });
  }
  return { frame, points };
}

test('cover, front and top keep full towers above controls on wide, short and phone stages', () => {
  const buildings = [
    ['huanghe', { x: 44, y: 56, z: 44 }],
    ['wuhan-landmarks', { x: 1800, y: 475.6, z: 300 }],
    ['wuhan-landmarks', { x: 170, y: 475.6, z: 180 }],
  ];
  for (const [asset, size] of buildings) for (const [width, height] of [[1050, 610], [740, 410], [270, 520], [185, 380]]) {
    for (const angle of ['cover', 'front', 'top']) projectFrame(size, asset, width, height, angle);
  }
});

test('Huanghe cover is a close, low front view and the skyline preserves a near-frontal row', () => {
  const { frame, points } = projectFrame({ x: 44, y: 56, z: 44 }, 'huanghe', 1050, 610);
  assert.ok(frame.direction.z < -0.9 && frame.direction.x < 0 && frame.direction.y < 0);
  assert.ok((Math.max(...points.map(p => p.y)) - Math.min(...points.map(p => p.y))) / 610 > 0.7);
  assert.ok(frame.offsetX < 0);
  const skyline = wuhanCoverFrame({ size: { x: 1800, y: 475.6, z: 300 }, asset: 'wuhan-landmarks', width: 1050, height: 610 });
  assert.ok(skyline.direction.z > 0.99 && Math.abs(skyline.direction.y) < 0.04);
  const phone = wuhanCoverFrame({ size: { x: 44, y: 56, z: 44 }, asset: 'huanghe', width: 270, height: 520 });
  assert.equal(phone.offsetX, 0);
});

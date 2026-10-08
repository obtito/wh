import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Vector3 } from 'three';
import { mausoleumCoverFrame } from '../public/previews/heritage-framing.js';

const hall = { min: [-0.208, -0.02, -0.188], max: [0.208, 0.928, 0.289] };
test('the frontal memorial hall stays centered and clear of controls across viewport shapes', () => {
  for (const [width, height] of [[1190, 478], [600, 580], [285, 410], [360, 560], [950, 340]]) {
    const frame = mausoleumCoverFrame({ ...hall, width, height });
    const camera = new PerspectiveCamera(40, width / height, 0.03, 500);
    camera.position.fromArray(frame.position);
    camera.lookAt(new Vector3().fromArray(frame.target));
    camera.setViewOffset(width, height, 0, frame.offsetY, width, height);
    camera.updateMatrixWorld();
    assert.equal(camera.position.x, 0);
    assert.ok(camera.position.z > hall.max[2]);
    assert.ok(camera.position.y < frame.target[1]);
    for (const x of [hall.min[0], hall.max[0]]) for (const y of [hall.min[1], hall.max[1]]) for (const z of [hall.min[2], hall.max[2]]) {
      const point = new Vector3(x, y, z).project(camera);
      const px = (point.x + 1) * width / 2, py = (1 - point.y) * height / 2;
      assert.ok(px > 0 && px < width);
      assert.ok(py >= frame.top && py <= height - frame.bottom, `${width}x${height}: y=${py}`);
      assert.ok(point.z > -1 && point.z < 1);
    }
  }
});
test('empty viewports and degenerate model bounds fail without an invalid camera', () => {
  for (const invalid of [{ width: 0 }, { height: NaN }, { fov: 180 }, { max: hall.min }]) {
    assert.throws(() => mausoleumCoverFrame({ ...hall, width: 600, height: 580, ...invalid }), /Invalid/);
  }
});

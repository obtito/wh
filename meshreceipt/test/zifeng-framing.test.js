import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { ZIFENG_COVER_VIEW, zifengFrame } from '../public/previews/zifeng-framing.js';
import { landmarkCatalog } from '../server/landmarks.js';
import sharp from 'sharp';

const size = { x: 3.8, y: 15, z: 4.5 };
const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
function assertVisible(frame, width, height, angle = null) {
  const basis = angle === null ? frame : zifengFrame({ size, width, height, angle });
  const tanY = Math.tan(38 * Math.PI / 360), tanX = tanY * width / height;
  for (const x of [-size.x / 2, size.x / 2]) for (const y of [-size.y / 2, size.y / 2]) for (const z of [-size.z / 2, size.z / 2]) {
    const p = { x, y, z }, depth = frame.distance - dot(p, basis.direction);
    assert.ok(depth > 0);
    const px = width * (1 + dot(p, basis.right) / (depth * tanX)) / 2;
    const py = height * (1 - dot(p, basis.up) / (depth * tanY)) / 2 - frame.offsetY;
    assert.ok(px >= frame.side && px <= width - frame.side, `x=${px}`);
    assert.ok(py >= frame.top && py <= height - frame.bottom, `y=${py}`);
  }
}
test('spire and podium fit the unobstructed viewport in desktop, phone and short layouts', () => {
  for (const [width, height, top, bottom] of [[1190, 478, 24, 82], [360, 560, 88, 112], [285, 410, 88, 144], [950, 340, 24, 82]]) {
    for (const angle of [-Math.PI / 2, 0, Math.PI / 2, Math.PI, 2.35]) {
      const frame = zifengFrame({ size, width, height, angle, top, bottom, side: 17 });
      assertVisible(frame, width, height);
    }
  }
});
test('default whole-building view uses over 70% of desktop height, not the old empty framing', () => {
  const width = 1190, height = 478, frame = zifengFrame({ size, width, height, top: 24, bottom: 82 });
  const projections = [];
  for (const x of [-size.x / 2, size.x / 2]) for (const y of [-size.y / 2, size.y / 2]) for (const z of [-size.z / 2, size.z / 2]) {
    const p = { x, y, z };
    projections.push(height * (1 - dot(p, frame.up) / ((frame.distance - dot(p, frame.direction)) * Math.tan(38 * Math.PI / 360))) / 2 - frame.offsetY);
  }
  assert.ok((Math.max(...projections) - Math.min(...projections)) / height > 0.7);
});
test('automatic rotation keeps all angles clear of the toolbar', () => {
  for (const [width, height, top, bottom] of [[1190, 478, 24, 82], [285, 410, 88, 144]]) {
    const frame = zifengFrame({ size, width, height, top, bottom, orbitSafe: true });
    for (let i = 0; i < 72; i++) assertVisible(frame, width, height, i * Math.PI / 36);
  }
});
test('invalid framing inputs cannot produce an infinite or clipped preset', () => {
  const args = { size, width: 1190, height: 478 };
  for (const invalid of [{ width: 0 }, { angle: NaN }, { pitch: NaN }, { fov: 180 }, { top: -1 }, { bottom: 500 }, { side: 600 }, { envelope: [] }, { envelope: [{ x: 0, y: NaN, z: 0 }] }, { size: { ...size, y: Infinity } }]) {
    assert.throws(() => zifengFrame({ ...args, ...invalid }), /Invalid/);
  }
});
test('cover preset keeps the annex to the left and looks slightly up at the main facade', () => {
  const frame = zifengFrame({ size, width: 1190, height: 478 });
  // Surveyed annex is west and north of the main tower in the original model.
  const annexFromTower = { x: -2.3, y: 0, z: -1.2 };
  assert.ok(dot(annexFromTower, frame.right) < 0);
  assert.ok(frame.direction.y < 0 && frame.direction.y > -0.06);
  assert.ok(frame.direction.x < 0 && frame.direction.z > 0);
  assert.equal(Math.atan2(frame.direction.z, frame.direction.x), ZIFENG_COVER_VIEW.angle);
});
test('a narrow spire uses the available height without reserving empty podium-width corners', () => {
  const envelope = [
    ...[-1, 1].flatMap(x => [-1, 1].map(z => ({ x: x * size.x / 2, y: -size.y / 2, z: z * size.z / 2 }))),
    { x: 0, y: size.y / 2, z: 0 },
  ];
  for (const [width, height, top, bottom] of [[1190, 478, 24, 82], [360, 560, 88, 112], [285, 410, 88, 144]]) {
    const args = { size, width, height, top, bottom };
    const frame = zifengFrame({ ...args, envelope });
    assert.ok(frame.distance < zifengFrame(args).distance);
    for (const point of envelope) {
      const depth = frame.distance - dot(point, frame.direction);
      const tanY = Math.tan(38 * Math.PI / 360), tanX = tanY * width / height;
      const px = width * (1 + dot(point, frame.right) / (depth * tanX)) / 2 - frame.offsetX;
      const py = height * (1 - dot(point, frame.up) / (depth * tanY)) / 2 - frame.offsetY;
      assert.ok(px >= frame.side && px <= width - frame.side);
      assert.ok(py >= frame.top && py <= height - frame.bottom);
    }
  }
});
test('larger Zifeng preview reuses the original builder and remains explicitly unaccepted', async () => {
  const item = (await landmarkCatalog('/nonexistent-meshreceipt-fixture')).find(item => item.id === 'zifeng');
  assert.equal(item.previewUrl, '/previews/zifeng.html'); assert.equal(item.previewOnly, true);
  assert.equal(item.poster, '/previews/zifeng-poster-cinematic.png'); assert.equal(item.posterKind, '电影感艺术封面');
  assert.match(item.story, /原几何、材质及比例不改写/); assert.match(item.story, /尚未导出/);
  const js = await readFile(new URL('../public/previews/zifeng.js', import.meta.url), 'utf8');
  assert.match(js, /buildZifeng.*\/api\/source\/nanjing\/js\/zifeng.js/);
  assert.doesNotMatch(js, /building\.scale\.(set|setScalar)/);
  const html = await readFile(new URL('../public/previews/zifeng.html', import.meta.url), 'utf8');
  assert.match(html, /独立大屏/); assert.match(html, /role="alert"/);
});
test('clean cover uses the actual renderer, a card-sized frame and uncropped image styling', async () => {
  const image = await sharp(await readFile(new URL('../public/previews/zifeng-poster.jpg', import.meta.url))).metadata();
  assert.equal(image.format, 'jpeg'); assert.ok(image.width >= 900 && image.height >= 600);
  assert.ok(Math.abs(image.width / image.height - 1.42) < 0.01);
  const html = await readFile(new URL('../public/previews/zifeng.html', import.meta.url), 'utf8');
  const js = await readFile(new URL('../public/previews/zifeng.js', import.meta.url), 'utf8');
  const css = await readFile(new URL('../web/style.css', import.meta.url), 'utf8');
  assert.match(html, /\.cover-mode \.caption,\.cover-mode \.hint,\.cover-mode \.toolbar\{display:none\}/);
  assert.match(js, /coverMode = query.get\('cover'\) === '1'/);
  assert.match(js, /viewport.appendChild\(renderer.domElement\)/);
  assert.match(css, /\.asset-poster\[src\*="zifeng-poster"\]\{object-fit:contain/);
  const frame = zifengFrame({ size, width: image.width, height: image.height, top: 24, bottom: 32 });
  assertVisible(frame, image.width, image.height);
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { landmarkCatalog } from '../server/landmarks.js';
import { HERITAGE } from '../public/previews/heritage-data.js';
import { WUHAN_TOWERS, wuhanModelPath } from '../public/previews/wuhan-data.js';

test('displayed mausoleum is preview-only and attributed; Ming Xiaoling is removed from the catalog', async () => {
  const catalog = await landmarkCatalog('/nonexistent-meshreceipt-fixture');
  assert.equal(catalog.length, 5);
  assert.equal(catalog.some(item => item.id === 'mingxiaoling'), false);
  const asset = catalog.find(item => item.id === 'zhongshanling');
  assert.equal(asset.previewOnly, true); assert.equal(asset.file, undefined);
  assert.equal(asset.previewUrl, '/previews/heritage.html?asset=zhongshanling');
  assert.equal(asset.poster, '/previews/zhongshanling-poster-cinematic-clear.png');
  assert.match(asset.source, /GTA-NJ/); assert.match(asset.story, /不是独立构件资产/);
  assert.match(asset.license, /分别核对授权/);
});

test('Wuhan is one five-building collection with individual sources, not an acceptance model', async () => {
  const catalog = await landmarkCatalog('/nonexistent-meshreceipt-fixture');
  const group = catalog.find(item => item.id === 'wuhan-landmarks');
  assert.equal(group.previewOnly, true); assert.equal(group.modelUrl, undefined); assert.equal(group.file, undefined);
  assert.equal(group.title, '武汉地标建筑'); assert.equal(group.components.length, 5);
  assert.equal(group.previewUrl, '/previews/wuhan.html?asset=wuhan-landmarks');
  assert.match(group.readiness, /0\/5/); assert.match(group.story, /不是实际地理位置/);
  assert.deepEqual(group.components.map(item => item.name), ['武汉绿地中心', '武汉中心', '周大福金融中心', '武汉航运中心', '泛海时代广场']);
  assert.equal(new Set(group.components.map(item => item.sourceUrl)).size, 5);
  assert.ok(group.components.every(item => !item.ready && item.author === 'Void' && item.sourceUrl.startsWith('https://sketchfab.com/')));
  assert.ok(WUHAN_TOWERS.every(item => item.displayHeight > 0));
  const yellow = catalog.find(item => item.id === 'huanghe');
  assert.equal(yellow.previewOnly, true); assert.equal(yellow.previewUrl, null); assert.equal(yellow.modelUrl, null);
  assert.match(yellow.story, /尚未导出为可验收 GLB/);
  assert.match(yellow.subtitle, /GLB 最新展示修订/);
  assert.match(yellow.source, /本地展示修订/);
  assert.match(yellow.license, /不能沿用 GLB/);
  assert.equal(yellow.defaultVersion, 'glb-latest');
  assert.deepEqual(yellow.versions.map(item => item.id), ['blender-refined', 'glb-latest', 'glb-original', 'code-stage3']);
  assert.ok(yellow.versions.every(item => !item.ready));
});

test('a tower is ready only when its referenced binary and textures exist', async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'meshreceipt-wuhan-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const file = path.join(workspace, 'GTA-WH', wuhanModelPath(WUHAN_TOWERS[0]));
  const root = path.dirname(file); await mkdir(path.join(root, 'textures'), { recursive: true });
  const model = { asset: { version: '2.0' }, meshes: [{}], buffers: [{ uri: 'scene.bin' }], images: [{ uri: 'textures/base.png' }] };
  await writeFile(file, JSON.stringify(model));
  let catalog = await landmarkCatalog(workspace);
  assert.equal(catalog.find(item => item.id === 'wuhan-landmarks').components[0].ready, false);
  await writeFile(path.join(root, 'scene.bin'), Buffer.alloc(20));
  await writeFile(path.join(root, 'textures/base.png'), Buffer.alloc(20));
  catalog = await landmarkCatalog(workspace);
  assert.equal(catalog.find(item => item.id === 'wuhan-landmarks').components[0].ready, true);
  assert.match(catalog.find(item => item.id === 'wuhan-landmarks').readiness, /1\/5/);
  model.images[0].uri = '../outside.png';
  await writeFile(file, JSON.stringify(model));
  catalog = await landmarkCatalog(workspace);
  assert.equal(catalog.find(item => item.id === 'wuhan-landmarks').components[0].ready, false);
});

test('viewpoint series have valid unique locations and disclose simplified/missing geometry', () => {
  assert.equal(HERITAGE.mingxiaoling.components.length, 12);
  assert.equal(HERITAGE.zhongshanling.components.length, 7);
  for (const group of Object.values(HERITAGE)) {
    assert.equal(new Set(group.components.map(part => part.name)).size, group.components.length);
    for (const part of group.components) {
      assert.equal(Number.isFinite(part.z), true); assert.ok(part.span > 0 && Number.isFinite(part.span));
    }
  }
  assert.match(HERITAGE.mingxiaoling.limitation, /未装载外部扫描/);
  assert.match(HERITAGE.mingxiaoling.components.find(part => part.name === '御河桥位置').note, /未装载/);
  assert.match(HERITAGE.zhongshanling.limitation, /不是逐级精确/);
});

test('versions have independent readiness; a missing default never silently falls back to code', async t => {
  const workspace = await mkdtemp(path.join(os.tmpdir(), 'meshreceipt-code-tower-'));
  t.after(() => rm(workspace, { recursive: true, force: true }));
  const vendor = path.join(workspace, 'GTA-WH', 'vendor'); await mkdir(vendor, { recursive: true });
  for (const name of ['three.module.js', 'OrbitControls.js']) await writeFile(path.join(vendor, name), '// fixture dependency '.repeat(2));
  const yellow = (await landmarkCatalog(workspace)).find(item => item.id === 'huanghe');
  assert.equal(yellow.previewOnly, true); assert.equal(yellow.modelUrl, null);
  assert.equal(yellow.previewUrl, null); assert.equal(yellow.poster, null);
  assert.equal(yellow.components[0].ready, false);
  assert.equal(yellow.versions.find(item => item.id === 'code-stage3').ready, true);
  assert.equal(yellow.sourceUrl, '/previews/models/huanghe-glb/source.json');
  const root = path.join(workspace, 'GTA-WH', 'assets/models/huanghe-tower'); await mkdir(root, { recursive: true });
  await writeFile(path.join(root, 'huanghe-main-tower-lod2.glb'), Buffer.alloc(32));
  assert.equal((await landmarkCatalog(workspace)).find(item => item.id === 'huanghe').previewUrl, null);
  await mkdir(path.join(vendor, 'utils'));
  for (const name of ['GLTFLoader.js', 'meshopt_decoder.module.js', 'utils/BufferGeometryUtils.js']) {
    await writeFile(path.join(vendor, name), '// fixture dependency '.repeat(2));
  }
  const ready = (await landmarkCatalog(workspace)).find(item => item.id === 'huanghe');
  assert.equal(ready.previewUrl, '/previews/wuhan.html?asset=huanghe');
  assert.equal(ready.poster, '/previews/huanghe-poster-cinematic-lit.png');
  assert.ok(ready.versions.every(item => item.ready));
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, rm } from 'node:fs/promises';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { CITY_FILES, freezeCity, digest } from '../scripts/snapshot-city.js';
import { POINT_IDS, createPoints, filterPoints, layoutLabels, pointRequest, validateRoads } from '../public/city/plan.js';
import { verifySnapshot } from '../public/city/snapshot-check.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const landmarks = POINT_IDS.map((id, i) => ({ id, name: `点位${i}`, lon: 114.29 + i / 1000, lat: 30.56, heightM: 50 }));
const version = 'a'.repeat(64);
const project = (lon, lat) => [lon * 1000, lat * -1000];

test('city points bind stable identifiers and the exact base, but do not invent approval or footprints', () => {
  const points = createPoints(landmarks, version, project);
  assert.equal(points.length, 8);
  assert.equal(new Set(points.map(point => point.pointId)).size, 8);
  assert.equal(points[0].pointId, 'wuhan:huanghelou');
  for (const point of points) {
    assert.equal(point.baseVersion, version); assert.equal(point.footprint, null);
    assert.equal(point.rotation, null); assert.equal(point.acceptedVersion, null); assert.equal(point.candidates, 0);
  }
  assert.equal(filterPoints(points, 'wuhan:huanghelou').length, 1);
  assert.deepEqual(filterPoints(points, '不在目录'), []);
});

test('invalid coordinates, missing source points or unbound base versions are rejected', () => {
  assert.throws(() => createPoints(landmarks, 'unbound', project));
  assert.throws(() => createPoints(landmarks.slice(1), version, project));
  assert.throws(() => createPoints([{ ...landmarks[0], lon: NaN }, ...landmarks.slice(1)], version, project));
  assert.throws(() => createPoints(landmarks, version, () => [Infinity, 0]));
});

test('point download is explicitly a draft and not an on-chain receipt or entitlement', () => {
  const draft = pointRequest(createPoints(landmarks, version, project)[0]);
  assert.equal(draft.readiness, 'draft-only'); assert.equal(draft.submissionEnabled, false); assert.equal(draft.onChain, false);
  assert.equal(draft.referencePlacement.units, 'meter'); assert.equal(draft.referencePlacement.zAxis, 'south');
  assert.equal(draft.footprint, null); assert.ok(draft.pending.includes('新建模型验收规则'));
  assert.throws(() => pointRequest({ state: 'accepted', coordinateStatus: 'reference-unverified' }));
});

test('nearby point labels separate without changing their geographic anchors', () => {
  const entries = Array.from({ length: 8 }, (_, i) => ({ id: i, x: 200 + i * 6, y: 350 + i * 3, width: 72, height: 26, selected: i === 7 }));
  const placed = layoutLabels(entries, 500, 700);
  assert.equal(placed.length, 8); assert.equal(placed[0].id, 7);
  for (const a of placed) {
    assert.equal(a.anchorX, entries[a.id].x); assert.equal(a.anchorY, entries[a.id].y);
    for (const b of placed) if (a.id !== b.id) assert.ok(!(a.box.left < b.box.right && a.box.right > b.box.left && a.box.top < b.box.bottom && a.box.bottom > b.box.top));
  }
});

test('reference road data requires bounded valid geometry, not an arbitrary payload', () => {
  const roads = [{ t: { highway: 'primary' }, g: [[114.2, 30.5], [114.3, 30.6]] }];
  assert.equal(validateRoads(roads), roads); assert.equal(validateRoads({ roads }), roads);
  for (const value of [null, {}, [{ t: {}, g: [[114.3, 30.5]] }], [{ t: {}, g: [[181, 30.5], [114.3, 30.6]] }],
    [{ t: {}, g: [[114.3, 30.5, 0], [114.3, 30.6]] }]]) assert.throws(() => validateRoads(value));
});

test('local extraction preserves source bytes, is self-contained and refuses to replace an existing version', async t => {
  const session = await mkdtemp(path.join(os.tmpdir(), 'meshreceipt-city-base-'));
  t.after(() => rm(session, { recursive: true, force: true }));
  const source = path.join(session, 'source'), destination = path.join(session, 'snapshot'); await mkdir(source);
  const road = [{ t: { highway: 'primary' }, g: [[114.2, 30.5], [114.3, 30.6]] }];
  for (const name of CITY_FILES) {
    await mkdir(path.dirname(path.join(source, name)), { recursive: true });
    const value = name.endsWith('roads.json') ? JSON.stringify(road)
      : name.endsWith('roads-land.json') ? JSON.stringify({ roads: road, stats: { inputRoads: 1, reroutedRoads: 0 } })
      : name.endsWith('wikidata-coords.json') ? JSON.stringify({ crs: 'WGS84 (EPSG:4326)', landmarks: [], featured_count: 0 })
      : `// owned source fixture: ${name}\n`;
    await writeFile(path.join(source, name), value);
  }
  const before = Object.fromEntries(await Promise.all(CITY_FILES.map(async name => [name, digest(await readFile(path.join(source, name)))])));
  const result = await freezeCity({ source, destination });
  const manifest = JSON.parse(await readFile(path.join(destination, 'snapshot.json')));
  assert.equal(result.files, 17); assert.equal(manifest.source.kind, 'local-worktree');
  assert.equal(manifest.counts.originalRoadRecords, 1);
  assert.equal(manifest.boundaries.modelAssetsIncluded, false); assert.equal(manifest.boundaries.communitySubmissionEnabled, false);
  const loaded = await verifySnapshot(manifest, async name => new Uint8Array(await readFile(path.join(destination, name))));
  assert.equal(loaded.size, 17);
  for (const name of CITY_FILES) assert.equal(digest(await readFile(path.join(source, name))), before[name]);
  await assert.rejects(freezeCity({ source, destination }), /already exists/);
  const roadFile = path.join(destination, 'data/osm/roads.json'); await writeFile(roadFile, '[]');
  await assert.rejects(verifySnapshot(manifest, async name => new Uint8Array(await readFile(path.join(destination, name)))), /指纹不一致/);
  const invalid = structuredClone(manifest); invalid.files['../leak'] = invalid.files['README.md'];
  await assert.rejects(verifySnapshot(invalid, () => assert.fail('should not read unlisted files')), /未允许/);
  const wrong = structuredClone(manifest); wrong.baseVersion = '0'.repeat(64);
  await assert.rejects(verifySnapshot(wrong, () => assert.fail('should not read mismatched base')), /版本/);
  await assert.rejects(freezeCity({ source: 'relative/path', destination: path.join(session, 'other') }), /absolute/);
});

test('current frozen city has verified source hashes and no model binary, game entry or remote dependency', async () => {
  const destination = path.join(root, 'public/city/snapshot');
  const manifest = JSON.parse(await readFile(path.join(destination, 'snapshot.json')));
  await verifySnapshot(manifest, async name => new Uint8Array(await readFile(path.join(destination, name))));
  assert.equal(manifest.source.directory, '/Users/Admin/Desktop/gta-wh');
  assert.equal(manifest.counts.originalRoadRecords, 2823); assert.equal(manifest.counts.sceneRoadRecords, 2972);
  assert.equal(manifest.rendering.threeVersion, '0.183.2');
  assert.ok(Object.keys(manifest.files).every(name => !/\.(glb|blend|bin)$/.test(name) && name !== 'index.html' && !name.includes('main.js')));
});

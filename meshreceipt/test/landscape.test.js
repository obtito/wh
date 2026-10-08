import test from 'node:test';
import assert from 'node:assert/strict';
import { landscapePlan, terrainHeight, isExhibitionBase, modernGardenBeds } from '../public/previews/landscape-plan.js';

const footprint = { minX: -31, maxX: 31, minZ: -31, maxZ: 31 };

test('landscaping is deterministic and differentiates heritage from modern styles', () => {
  const heritage = landscapePlan(footprint, 'heritage', 'huanghe');
  assert.deepEqual(heritage, landscapePlan(footprint, 'heritage', 'huanghe'));
  const modern = landscapePlan(footprint, 'modern', 'greenland');
  assert.ok(heritage.trees.length > 25); assert.ok(modern.trees.length > 8);
  assert.ok(heritage.trees.every(t => ['pine', 'cypress'].includes(t.species)));
  assert.ok(modern.trees.every(t => t.species === 'canopy'));
  assert.ok(heritage.rocks.length > 0); assert.equal(modern.rocks.length, 0);
});

test('plants remain outside source models and preserve the entrance axis', () => {
  for (const style of ['modern', 'heritage']) {
    const plan = landscapePlan(footprint, style, 'entry-check');
    for (const tree of plan.trees) {
      const e = plan.exclusion;
      assert.ok(tree.x <= e.minX || tree.x >= e.maxX || tree.z <= e.minZ || tree.z >= e.maxZ);
      if (tree.z > footprint.maxZ - 2) assert.ok(Math.abs(tree.x - plan.court.x) >= plan.court.width / 2 + 5);
      assert.ok(tree.height > 0 && tree.radius > 0);
      assert.ok(tree.x > plan.plot.minX && tree.x < plan.plot.maxX && tree.z > plan.plot.minZ && tree.z < plan.plot.maxZ);
    }
  }
});

test('heritage terrain meets existing stair foot and slopes stay bounded', () => {
  const plan = landscapePlan(footprint, 'heritage', 'terrain');
  for (const [x, z] of [[0, 0], [31, 31], [-31, -31], [0, 55]]) assert.equal(terrainHeight(x, z, plan), -0.3);
  assert.ok(terrainHeight(0, -65, plan) > 0);
  for (const x of [-1000, -100, 0, 100, 1000]) for (const z of [-1000, -100, 0, 100, 1000]) {
    const y = terrainHeight(x, z, plan); assert.ok(Number.isFinite(y) && y >= -0.3 && y < 7);
  }
  assert.equal(terrainHeight(100, -100, landscapePlan(footprint, 'modern', 'flat')), -0.3);
});

test('invalid or unbounded landscaping dimensions are rejected', () => {
  assert.throws(() => landscapePlan({ ...footprint, maxX: Infinity }, 'heritage', 'x'), /footprint/);
  assert.throws(() => landscapePlan({ ...footprint, maxX: -32 }, 'modern', 'x'), /footprint/);
  assert.throws(() => landscapePlan({ ...footprint, maxX: 10000 }, 'modern', 'x'), /footprint/);
  assert.throws(() => landscapePlan(footprint, 'unknown', 'x'), /style/);
});

test('base dressing excludes roofs, raised podiums, and small ground details', () => {
  assert.equal(isExhibitionBase({ ...footprint, minY: 0, maxY: 0 }, footprint), true);
  assert.equal(isExhibitionBase({ ...footprint, minY: 12, maxY: 12 }, footprint), false);
  assert.equal(isExhibitionBase({ ...footprint, minY: 0, maxY: 2 }, footprint), false);
  assert.equal(isExhibitionBase({ ...footprint, maxX: -20, minY: 0, maxY: 0 }, footprint), false);
});

test('inner modern lawns stay inside export ground and away from authored building geometry', () => {
  const occupied = { minX: -10, maxX: 10, minZ: -8, maxZ: 8 };
  const large = { minX: -150, maxX: 150, minZ: -140, maxZ: 140 };
  const beds = modernGardenBeds(large, occupied);
  assert.equal(beds.length, 3);
  for (const bed of beds) {
    const minX = bed.x - bed.width / 2, maxX = bed.x + bed.width / 2, minZ = bed.z - bed.depth / 2, maxZ = bed.z + bed.depth / 2;
    assert.ok(minX > large.minX && maxX < large.maxX && minZ > large.minZ && maxZ < large.maxZ);
    assert.ok(maxX < occupied.minX - 5 || minX > occupied.maxX + 5 || maxZ < occupied.minZ - 5);
  }
  assert.deepEqual(modernGardenBeds(large, null), []);
  assert.deepEqual(modernGardenBeds(large, { ...occupied, maxX: Infinity }), []);
  assert.deepEqual(modernGardenBeds(footprint, footprint), []);
});

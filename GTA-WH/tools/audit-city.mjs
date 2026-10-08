// 城市几何自检:直接读烘焙产物,量化"穿模"是否清零
//   ① 建筑压路面带(路穿楼)  ② 建筑压模型占地圆  ③ 建筑落水
//   ④ 碰撞网格有效性/净空率/查询性能
// 用法: node tools/audit-city.mjs
import { readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { toV2, toV2List, pointInPolygon, distToPolyline, clamp } from '../js/geo.js';
import { RIVER, LAKES, ROADS } from '../js/data.js';
import { allExclusions } from '../js/sites.js';
import { CollisionGrid } from '../js/collision.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const meta = JSON.parse(readFileSync(resolve(ROOT, 'data/city-meta.json'), 'utf8'));
const bin = readFileSync(resolve(ROOT, 'data/city.bin'));
const cBuf = readFileSync(resolve(ROOT, 'data/city-collision.bin'));
const coll = new Float32Array(cBuf.buffer, cBuf.byteOffset, cBuf.byteLength / 4);
const N = coll.length / 7;

let pass = 0, fail = 0;
const ok = (cond, msg, detail = '') => {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg} ${detail}`); }
};

console.log('== 1. 产物完整性 ==');
{
  ok(meta.count === N, `建筑数 ${meta.count} = 碰撞盒数 ${N}`);
  let v = 0, i = 0;
  for (const b of Object.values(meta.buckets)) { v += b.vCount; i += b.iCount; }
  ok(v > 1e6, `顶点 ${(v / 1e6).toFixed(2)}M`);
  ok(i > 1e6, `索引 ${(i / 1e6).toFixed(2)}M`);
  ok(bin.byteLength > 50 * 1048576, `city.bin ${(bin.byteLength / 1048576).toFixed(1)} MB`);
}

console.log('== 2. 碰撞盒几何有效性 ==');
{
  let bad = 0, tiny = 0, huge = 0, maxSide = 0;
  for (let k = 0; k < coll.length; k += 7) {
    const hx = coll[k + 2], hz = coll[k + 3], c = coll[k + 4], s = coll[k + 5], top = coll[k + 6];
    if (!Number.isFinite(hx + hz + top) || Math.abs(c * c + s * s - 1) > 1e-3) bad++;
    if (hx <= 0 || hz <= 0) tiny++;
    const side = Math.max(hx, hz) * 2;
    if (side > maxSide) maxSide = side;
    if (side > 400) huge++;
  }
  ok(bad === 0, '无非有限值 / 旋转均已归一化', `异常 ${bad}`);
  ok(tiny === 0, '无退化尺寸', `退化 ${tiny}`);
  ok(huge === 0, `无 >400 m 异常体块(最大边长 ${maxSide.toFixed(0)} m)`, `异常 ${huge}`);
}

/* ---------- 重建烘焙期的道路走廊掩膜(与 build-city-bin 同参) ---------- */
const MASK_RES = 6;
const HW_W = { motorway: 40, trunk: 34, trunk_link: 16, primary: 28, primary_link: 14, secondary: 22, secondary_link: 12, tertiary: 16, tertiary_link: 10 };
const mask = (() => {
  let x0 = Infinity, z0 = Infinity, x1 = -Infinity, z1 = -Infinity;
  const lines = [];
  for (const r of ROADS) lines.push({ pts: toV2List(r.pts), hw: r.w / 2 });
  try {
    const osm = JSON.parse(readFileSync(resolve(ROOT, 'data/osm/roads.json'), 'utf8'));
    for (const r of osm) {
      if (r.t?.tunnel) continue;
      lines.push({ pts: r.g.map(([lo, la]) => toV2(lo, la)), hw: (HW_W[r.t?.highway] ?? 10) / 2 });
    }
  } catch { /* 无 OSM 路网 */ }
  for (const l of lines) {
    for (const [x, z] of l.pts) {
      const r = l.hw;
      if (x - r < x0) x0 = x - r; if (x + r > x1) x1 = x + r;
      if (z - r < z0) z0 = z - r; if (z + r > z1) z1 = z + r;
    }
  }
  const nx = Math.ceil((x1 - x0) / MASK_RES), nz = Math.ceil((z1 - z0) / MASK_RES);
  const buf = new Uint8Array(nx * nz);
  const stamp = (x, z, r) => {
    const c0 = Math.max(0, ((x - r - x0) / MASK_RES) | 0);
    const c1 = Math.min(nx - 1, ((x + r - x0) / MASK_RES) | 0);
    const r0 = Math.max(0, ((z - r - z0) / MASK_RES) | 0);
    const r1 = Math.min(nz - 1, ((z + r - z0) / MASK_RES) | 0);
    const rr = r * r;
    for (let ix = c0; ix <= c1; ix++) {
      const dx = x0 + ix * MASK_RES + MASK_RES / 2 - x;
      const base = ix * nz;
      for (let iz = r0; iz <= r1; iz++) {
        const dz = z0 + iz * MASK_RES + MASK_RES / 2 - z;
        if (dx * dx + dz * dz <= rr) buf[base + iz] = 1;
      }
    }
  };
  let samples = 0;
  for (const l of lines) {
    for (let i = 1; i < l.pts.length; i++) {
      const [ax, az] = l.pts[i - 1], [bx, bz] = l.pts[i];
      const d = Math.hypot(bx - ax, bz - az);
      const n = Math.max(1, Math.ceil(d / 3));
      for (let k = 0; k <= n; k++) {
        const t = k / n;
        stamp(ax + (bx - ax) * t, az + (bz - az) * t, l.hw);
        samples++;
      }
    }
  }
  const hit = (x, z) => {
    const ix = ((x - x0) / MASK_RES) | 0, iz = ((z - z0) / MASK_RES) | 0;
    if (ix < 0 || iz < 0 || ix >= nx || iz >= nz) return false;
    return buf[ix * nz + iz] === 1;
  };
  return { hit, lines, nx, nz, samples };
})();

console.log('== 3. 路穿楼(逐盒内部撒点检测) ==');
{
  let bad = 0, tested = 0;
  for (let k = 0; k < coll.length; k += 7) {
    const cx = coll[k], cz = coll[k + 1], hx = coll[k + 2], hz = coll[k + 3], c = coll[k + 4], s = coll[k + 5];
    // 盒内按 6 m 网格撒点(local → world)
    const nx = Math.max(1, Math.ceil(hx * 2 / 6)), nz = Math.max(1, Math.ceil(hz * 2 / 6));
    for (let a = 0; a <= nx; a++) {
      for (let b = 0; b <= nz; b++) {
        const lx = -hx + (hx * 2) * a / nx, lz = -hz + (hz * 2) * b / nz;
        tested++;
        if (mask.hit(cx + lx * c + lz * s, cz - lx * s + lz * c)) { bad++; a = nx; break; }
      }
    }
  }
  ok(bad === 0, `无建筑压路面带(检测 ${N} 盒 / ${tested} 点)`, `压路盒 ${bad}`);
  console.log(`  · 走廊掩膜 ${mask.nx}×${mask.nz} @${MASK_RES}m,路网采样 ${mask.samples} 点`);
}

console.log('== 4. 楼落水 / 压模型占地 ==');
{
  const riverPts = toV2List(RIVER.pts);
  const branches = RIVER.branches.map((b) => ({ hw: b.halfWidth, pts: toV2List(b.pts) }));
  const lakes = LAKES.map((l) => toV2List(l.pts));
  const yangtzeHalf = (t) => RIVER.halfWidth * (0.82 + 0.30 * Math.sin(Math.PI * clamp(t, 0, 1))
    - 0.12 * Math.exp(-Math.pow((t - 0.33) / 0.06, 2)) + 0.06 * Math.sin(t * 21));
  const cum = [0];
  for (let i = 1; i < riverPts.length; i++) cum.push(cum[i - 1] + Math.hypot(riverPts[i][0] - riverPts[i - 1][0], riverPts[i][1] - riverPts[i - 1][1]));
  const total = cum[cum.length - 1];
  let wet = 0, inSite = 0;
  const excl = allExclusions();
  for (let k = 0; k < coll.length; k += 7) {
    const cx = coll[k], cz = coll[k + 1];
    // 长江:最近点 + 沿程半宽
    let best = Infinity, bt = 0;
    for (let i = 1; i < riverPts.length; i++) {
      const ax = riverPts[i - 1][0], az = riverPts[i - 1][1], bx = riverPts[i][0], bz = riverPts[i][1];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz || 1e-12;
      let t = ((cx - ax) * dx + (cz - az) * dz) / l2;
      t = clamp(t, 0, 1);
      const d = Math.hypot(cx - ax - dx * t, cz - az - dz * t);
      if (d < best) { best = d; bt = (cum[i - 1] + t * (cum[i] - cum[i - 1])) / total; }
    }
    let w = best < yangtzeHalf(bt);
    if (!w) for (const b of branches) if (distToPolyline(cx, cz, b.pts) < b.hw) { w = true; break; }
    if (!w) for (const p of lakes) if (pointInPolygon(cx, cz, p)) { w = true; break; }
    if (w) wet++;
    for (const e of excl) {
      const dx = cx - e.x, dz = cz - e.z;
      if (dx * dx + dz * dz < e.r * e.r) { inSite++; break; }
    }
  }
  ok(wet === 0, '无建筑落在长江/汉江/湖面', `落水 ${wet}`);
  ok(inSite === 0, `无建筑压 ${excl.length} 处模型占地圆`, `压占地 ${inSite}`);
}

console.log('== 5. 碰撞网格:净空率与性能 ==');
{
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (let k = 0; k < coll.length; k += 7) {
    const x = coll[k], z = coll[k + 1];
    if (x < minX) minX = x; if (x > maxX) maxX = x;
    if (z < minZ) minZ = z; if (z > maxZ) maxZ = z;
  }
  const grid = new CollisionGrid(28).addRaw(coll).build();
  let free = 0, total = 0;
  for (let x = minX; x < maxX; x += 40) {
    for (let z = minZ; z < maxZ; z += 40) { total++; if (grid.free(x, z, 0, 0)) free++; }
  }
  ok(free / total > 0.35, `地表净空率 ${(free / total * 100).toFixed(1)}%(街道/水面/绿地占比正常)`);
  console.log(`  · 覆盖 ${((maxX - minX) / 1000).toFixed(1)}×${((maxZ - minZ) / 1000).toFixed(1)} km,抽样 ${total} 点`);

  const t0 = process.hrtime.bigint();
  const M = 20000;
  let hits = 0;
  const out = { x: 0, z: 0, hit: false };
  for (let k = 0; k < M; k++) {
    const i = ((k * 7919) % N) * 7;
    grid.resolve(coll[i], coll[i + 1], 1.3, 0, out);
    if (out.hit) hits++;
  }
  const ms = Number(process.hrtime.bigint() - t0) / 1e6;
  ok(ms / M < 0.02, `${M} 次推出查询 ${ms.toFixed(1)} ms(${(ms / M * 1000).toFixed(2)} µs/次)`);
  console.log(`  · 盒心命中率 ${(hits / M * 100).toFixed(1)}%(应接近 100%)`);
}

console.log(`\n自检结果:${pass} 通过,${fail} 失败`);
process.exit(fail ? 1 : 0);

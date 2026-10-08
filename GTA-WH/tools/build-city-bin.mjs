// Overture 建筑 → 渲染就绪二进制(构建期完成投影/挤出/着色,浏览器零构建成本)
// 用法: node tools/build-city-bin.mjs
// 输出:
//   data/city.bin            position/normal/uv/color(uint8)/index 分桶连续
//   data/city-meta.json      桶偏移 + 建筑数 + 碰撞盒数
//   data/city-collision.bin  建筑占地 OBB(stride 7: cx,cz,hx,hz,cos,sin,topY)
//
// 穿模治理(构建期解决的部分):
//   ① 场景空间水域判定(替代粗粒度 wetLL)→ 楼不落江/湖
//   ② 道路走廊栅格掩膜裁剪        → 路面不穿楼、车流走廊不堵楼
//   ③ 真楼/摄影测量模型占地圆裁剪 → GLB 地标不再与白模重叠
//   ④ 坡地取 footprint 最低地形   → 楼体不悬空
import { writeFileSync, readFileSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as THREE from '../vendor/three.module.js';
import { toV2, pointInPolygon, distToPolyline, clamp } from '../js/geo.js';
import { RIVER, LAKES, MOUNTAINS, ROADS } from '../js/data.js';
import { allExclusions } from '../js/sites.js';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
// CNBH-10m 真实高度回填(CC BY 4.0,93% 覆盖;对超高建筑低估 → 核心区大楼做恢复)
let CNBH = {};
try { CNBH = JSON.parse((await import('node:fs')).readFileSync(resolve(ROOT, 'data/cnbh-heights.json'), 'utf8')); } catch {}

/* ==================== 地形高度(与 world.js 一致) ==================== */
const mountains = MOUNTAINS.map((m, i) => ({ ...m, x: 0, z: 0, seed: 71 + i * 13, rot: (m.rot || 0) * Math.PI / 180 }));
for (const m of mountains) { [m.x, m.z] = toV2(m.lon, m.lat); }
function noise2(x, y, seed) {
  const xi = Math.floor(x), yi = Math.floor(y), xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const h = (i, j) => {
    let n = Math.imul(i, 0x27d4eb2d) ^ Math.imul(j, 0x165667b1) ^ Math.imul(seed, 0x9e3779b9);
    n = Math.imul(n ^ (n >>> 15), 0x85ebca6b); n ^= n >>> 13; n = Math.imul(n, 0xc2b2ae35);
    return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
  };
  return (h(xi, yi) * (1 - u) + h(xi + 1, yi) * u) * (1 - v) + (h(xi, yi + 1) * (1 - u) + h(xi + 1, yi + 1) * u) * v;
}
function fbm(x, y, oct, seed) {
  let a = 0.5, f = 1, s = 0, n = 0;
  for (let i = 0; i < oct; i++) { s += noise2(x * f, y * f, seed + i * 17) * a; n += a; a *= 0.5; f *= 2.03; }
  return s / n;
}
function terrainHeight(x, z) {
  let h = 0;
  for (const m of mountains) {
    const dx0 = x - m.x, dz0 = z - m.z, c = Math.cos(-m.rot), s = Math.sin(-m.rot);
    const dx = (dx0 * c - dz0 * s) / m.rx, dz = (dx0 * s + dz0 * c) / m.rz;
    const r = Math.hypot(dx, dz);
    if (r >= 1) continue;
    h += Math.pow(Math.cos((r * Math.PI) / 2), 1.7) * (0.66 + 0.6 * fbm(x * 0.004, z * 0.004, 4, m.seed) * (m.rough ?? 0.5)) * (0.92 + 0.14 * noise2(x * 0.02, z * 0.02, m.seed + 5)) * m.h;
  }
  return h;
}

/* ==================== 场景空间水域判定(精确) ==================== */
const riverPts = RIVER.pts.map(([lo, la]) => toV2(lo, la));
const riverCum = [0];
for (let i = 1; i < riverPts.length; i++) {
  riverCum.push(riverCum[i - 1] + Math.hypot(riverPts[i][0] - riverPts[i - 1][0], riverPts[i][1] - riverPts[i - 1][1]));
}
const riverTotal = riverCum[riverCum.length - 1];
/** 长江沿程全宽(与 world.js yangtzeWidth 同式) */
function yangtzeWidth(t) {
  return RIVER.halfWidth * 2 * (
    0.82
    + 0.30 * Math.sin(Math.PI * clamp(t, 0, 1))
    - 0.12 * Math.exp(-Math.pow((t - 0.33) / 0.06, 2))
    + 0.06 * Math.sin(t * 21)
  );
}
/** 点到长江的最近距离 + 沿程参数 t */
function riverDist(x, z) {
  let best = Infinity, bt = 0;
  for (let i = 1; i < riverPts.length; i++) {
    const ax = riverPts[i - 1][0], az = riverPts[i - 1][1];
    const bx = riverPts[i][0], bz = riverPts[i][1];
    const dx = bx - ax, dz = bz - az;
    const l2 = dx * dx + dz * dz || 1e-12;
    let t = ((x - ax) * dx + (z - az) * dz) / l2;
    t = clamp(t, 0, 1);
    const d = Math.hypot(x - ax - dx * t, z - az - dz * t);
    if (d < best) { best = d; bt = (riverCum[i - 1] + t * (riverCum[i] - riverCum[i - 1])) / riverTotal; }
  }
  return [best, bt];
}
const branchPts = RIVER.branches.map((b) => ({ hw: b.halfWidth, pts: b.pts.map(([lo, la]) => toV2(lo, la)) }));
const lakePolys = LAKES.map((l) => l.pts.map(([lo, la]) => toV2(lo, la)));

function isWaterScene(x, z) {
  const [d, t] = riverDist(x, z);
  if (d < yangtzeWidth(t) / 2) return true;
  for (const b of branchPts) if (distToPolyline(x, z, b.pts) < b.hw) return true;
  for (const p of lakePolys) if (pointInPolygon(x, z, p)) return true;
  return false;
}

/* ==================== 道路走廊栅格掩膜 ==================== */
const MASK_RES = 6;                 // 6 m 栅格
const mask = {
  x0: 0, z0: 0, nx: 0, nz: 0, buf: null,
  build(minX, minZ, maxX, maxZ) {
    this.x0 = minX; this.z0 = minZ;
    this.nx = Math.ceil((maxX - minX) / MASK_RES);
    this.nz = Math.ceil((maxZ - minZ) / MASK_RES);
    this.buf = new Uint8Array(this.nx * this.nz);
  },
  stamp(x, z, r) {
    const c0 = Math.max(0, ((x - r - this.x0) / MASK_RES) | 0);
    const c1 = Math.min(this.nx - 1, ((x + r - this.x0) / MASK_RES) | 0);
    const r0 = Math.max(0, ((z - r - this.z0) / MASK_RES) | 0);
    const r1 = Math.min(this.nz - 1, ((z + r - this.z0) / MASK_RES) | 0);
    const rr = r * r;
    for (let ix = c0; ix <= c1; ix++) {
      const dx = (this.x0 + ix * MASK_RES + MASK_RES / 2) - x;
      const base = ix * this.nz;
      for (let iz = r0; iz <= r1; iz++) {
        const dz = (this.z0 + iz * MASK_RES + MASK_RES / 2) - z;
        if (dx * dx + dz * dz <= rr) this.buf[base + iz] = 1;
      }
    }
  },
  hit(x, z) {
    const ix = ((x - this.x0) / MASK_RES) | 0;
    const iz = ((z - this.z0) / MASK_RES) | 0;
    if (ix < 0 || iz < 0 || ix >= this.nx || iz >= this.nz) return false;
    return this.buf[ix * this.nz + iz] === 1;
  },
};

/** 沿折线按 3 m 步长加盖走廊半宽 */
function stampCorridor(pts, halfW) {
  const r = halfW;
  for (let i = 1; i < pts.length; i++) {
    const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
    const d = Math.hypot(bx - ax, bz - az);
    const n = Math.max(1, Math.ceil(d / 3));
    for (let k = 0; k <= n; k++) {
      const t = k / n;
      mask.stamp(ax + (bx - ax) * t, az + (bz - az) * t, r);
    }
  }
}

/* ==================== 主流程 ==================== */
const src = JSON.parse(readFileSync(resolve(ROOT, 'data/overture-buildings.json'), 'utf8'));
const feats = src.features;
console.log('输入建筑:', feats.length);

/* ① 经纬度包围盒 → 场景包围盒 → 建掩膜 */
let loMin = 180, loMax = -180, laMin = 90, laMax = -90;
let featIdx = -1;
for (const f of feats) {
  featIdx++;
  const ring = f.geometry?.coordinates?.[0];
  if (!ring) continue;
  for (const [lo, la] of ring) {
    if (lo < loMin) loMin = lo; if (lo > loMax) loMax = lo;
    if (la < laMin) laMin = la; if (la > laMax) laMax = la;
  }
}
{
  const [ax, az] = toV2(loMin, laMax); const [bx, bz] = toV2(loMax, laMin);
  mask.build(Math.min(ax, bx) - 300, Math.min(az, bz) - 300, Math.max(ax, bx) + 300, Math.max(az, bz) + 300);
}
console.log(`掩膜: ${mask.nx}×${mask.nz} @${MASK_RES}m`);

/* ② 手绘主干道走廊 */
const HW_W = { motorway: 40, trunk: 34, trunk_link: 16, primary: 28, primary_link: 14, secondary: 22, secondary_link: 12, tertiary: 16, tertiary_link: 10 };
for (const r of ROADS) stampCorridor(r.pts.map(([lo, la]) => toV2(lo, la)), r.w / 2);
/* ③ OSM 真实路网走廊 */
try {
  const osmRoads = JSON.parse(readFileSync(resolve(ROOT, 'data/osm/roads.json'), 'utf8'));
  for (const r of osmRoads) {
    const hw = r.t?.highway;
    const w = HW_W[hw] ?? 10;
    if (r.t?.tunnel) continue;
    stampCorridor(r.g.map(([lo, la]) => toV2(lo, la)), w / 2);
  }
  console.log('走廊: OSM', osmRoads.length, '条 + 手绘', ROADS.length, '条');
} catch (e) { console.warn('OSM 路网不可用,仅手绘走廊:', e.message); }

/* ④ 模型占地圆 */
const excl = allExclusions();
console.log('占地排他圆:', excl.length, '处');

/* ---- 颜色 / 高度启发式 ---- */
const FACADE = {
  concrete: ['#cfcabb', '#c2bbab', '#b6b2a4', '#d6cec0', '#aca69a', '#bdb3a0'],
  glass: ['#8fa8bc', '#7d9cb4', '#a3b8c6', '#6f92aa', '#88a2b8'],
  civic: ['#d8cfc0', '#cfc4b2', '#c2b49e', '#d4c8b4'],
  lowrise: ['#c4917a', '#b5836e', '#cf9d86', '#a87862', '#d0a184'],
};
const ROOFS = ['#565a60', '#6b6560', '#75706a', '#4e5560', '#7d766e', '#5f6168', '#8a8378'];

const CENTER = [114.295, 30.560];
let rngS = 20261003;
function rand() { rngS = (rngS * 1664525 + 1013904223) >>> 0; return rngS / 4294967296; }

function buildingH(idx, tags, lon, lat, area) {
  const h = parseFloat(tags.height);
  if (Number.isFinite(h) && h > 2 && h < 640) return Math.min(h, 636);
  const lv = parseFloat(tags['building:levels'] ?? tags.num_floors ?? tags.levels);
  if (Number.isFinite(lv) && lv > 0) return Math.min(lv * 3.3 + 1.5, 636);
  const d = Math.hypot((lon - CENTER[0]) * 92, (lat - CENTER[1]) * 111);
  const core = Math.max(0, 1 - d / 8500);
  const r = rand();
  const heuristic = () => (area < 120 ? 6 + r * 4 + core * 3
    : area < 400 ? 9 + r * 8 + core * core * 14
    : area < 2000 ? 12 + r * 14 + core * core * 30
    : 14 + r * 20 + core * core * 46);
  // CNBH-10m 真实高度(93% 覆盖);超高建筑被低估 → 核心区大楼恢复
  const c = CNBH[String(idx)];
  if (Number.isFinite(c) && c > 2) {
    if (area > 700 && core > 0.3 && c < 32) return Math.max(c, 20 + r * 25 + core * core * 80);
    return c;
  }
  return heuristic();
}
function bucketOf(tags, area) {
  const b = tags.building || 'yes';
  if (['office', 'commercial', 'retail', 'hotel', 'supermarket', 'public'].includes(b)) return 'glass';
  if (['church', 'cathedral', 'temple', 'historic', 'civic', 'government'].includes(b)) return 'civic';
  if (['house', 'detached', 'bungalow', 'semidetached_house'].includes(b)) return 'lowrise';
  return area > 900 ? 'concrete' : 'lowrise';
}

/** PCA 主轴拟合 OBB(贴合旋转楼体,避免 AABB 过度膨胀吃掉街道) */
function obbOf(pts) {
  let cx = 0, cz = 0;
  for (const p of pts) { cx += p[0]; cz += p[1]; }
  cx /= pts.length; cz /= pts.length;
  let sxx = 0, szz = 0, sxz = 0;
  for (const p of pts) { const dx = p[0] - cx, dz = p[1] - cz; sxx += dx * dx; szz += dz * dz; sxz += dx * dz; }
  sxx /= pts.length; szz /= pts.length; sxz /= pts.length;
  const th = 0.5 * Math.atan2(2 * sxz, sxx - szz);
  const c = Math.cos(th), s = Math.sin(th);
  let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
  for (const p of pts) {
    const dx = p[0] - cx, dz = p[1] - cz;
    const lx = dx * c - dz * s;
    const lz = dx * s + dz * c;
    if (lx < a0) a0 = lx; if (lx > a1) a1 = lx;
    if (lz < b0) b0 = lz; if (lz > b1) b1 = lz;
  }
  const mx = (a0 + a1) / 2, mz = (b0 + b1) / 2;      // local → world 重定心
  return {
    cx: cx + mx * c + mz * s,
    cz: cz - mx * s + mz * c,
    hx: (a1 - a0) / 2, hz: (b1 - b0) / 2, c, s,
  };
}

const buckets = {};
for (const k of ['concrete', 'glass', 'civic', 'lowrise']) buckets[k] = { pos: [], nor: [], uv: [], col: [], idx: [] };
const coll = [];        // 碰撞 OBB(stride 7)
let count = 0;
const skip = { geom: 0, water: 0, road: 0, site: 0, area: 0, tiny: 0, huge: 0 };

for (const f of feats) {
  const geom = f.geometry;
  if (!geom || geom.type !== 'Polygon') { skip.geom++; continue; }
  const ringLL = geom.coordinates[0];
  if (!ringLL || ringLL.length < 4) { skip.geom++; continue; }

  let pts = ringLL.map(([lon, lat]) => toV2(lon, lat));
  const first = pts[0], last = pts[pts.length - 1];
  if (Math.abs(first[0] - last[0]) < 1e-6 && Math.abs(first[1] - last[1]) < 1e-6) pts = pts.slice(0, -1);
  if (pts.length < 3) { skip.tiny++; continue; }

  // 面积
  let a2 = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) a2 += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  const area = Math.abs(a2 / 2);
  if (area < 18) { skip.area++; continue; }
  // 超大轮廓(Overture 把整片小区/校园/机场合并成单个 Polygon)按 200 m 外接
  // 半径上限截断:否则会挤出 600 m 跨度的巨盒,把整片街区挡死
  {
    let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
    for (const [px, pz] of pts) {
      if (px < a0) a0 = px; if (px > a1) a1 = px;
      if (pz < b0) b0 = pz; if (pz > b1) b1 = pz;
    }
    const span = Math.max(a1 - a0, b1 - b0);
    if (span > 400 || area > 120000) { skip.huge++; continue; }
  }

  // 质心(用于水域/占地圆快速判定)
  let gx = 0, gz = 0;
  for (const p of pts) { gx += p[0]; gz += p[1]; }
  gx /= pts.length; gz /= pts.length;

  // ① 水域:质心 + 全部顶点(大 footprint 追加边中点)
  if (isWaterScene(gx, gz)) { skip.water++; continue; }
  let wet = false;
  for (const p of pts) { if (isWaterScene(p[0], p[1])) { wet = true; break; } }
  if (!wet && area > 1500) {
    for (let i = 0; i < pts.length; i++) {
      const p = pts[i], q = pts[(i + 1) % pts.length];
      if (isWaterScene((p[0] + q[0]) / 2, (p[1] + q[1]) / 2)) { wet = true; break; }
    }
  }
  if (wet) { skip.water++; continue; }

  // ② 道路走廊:按"碰撞包围盒"判,而非轮廓顶点。
  //    凹形/斜置楼体的 OBB 会在拐角外溢,若只测顶点,渲染上看似不压路,
  //    但碰撞盒已经盖住车道 → 车被隐形墙挡住。这里用与审计脚本一致的
  //    盒内撒点法,保证"看得见的楼"与"挡得住的盒"判据统一。
  const obb = obbOf(pts);
  let onRoad = false;
  {
    const step = MASK_RES;
    const na = Math.max(1, Math.ceil(obb.hx * 2 / step));
    const nb = Math.max(1, Math.ceil(obb.hz * 2 / step));
    for (let a = 0; a <= na && !onRoad; a++) {
      for (let b = 0; b <= nb; b++) {
        const lx = -obb.hx + obb.hx * 2 * a / na;
        const lz = -obb.hz + obb.hz * 2 * b / nb;
        if (mask.hit(obb.cx + lx * obb.c + lz * obb.s, obb.cz - lx * obb.s + lz * obb.c)) { onRoad = true; break; }
      }
    }
  }
  if (onRoad) { skip.road++; continue; }

  // ③ 模型占地圆
  let inSite = false;
  for (const e of excl) {
    const dx = gx - e.x, dz = gz - e.z;
    if (dx * dx + dz * dz < e.r * e.r) { inSite = true; break; }
  }
  if (!inSite) {
    for (const p of pts) {
      for (const e of excl) {
        const dx = p[0] - e.x, dz = p[1] - e.z;
        if (dx * dx + dz * dz < e.r * e.r) { inSite = true; break; }
      }
      if (inSite) break;
    }
  }
  if (inSite) { skip.site++; continue; }

  // 抽稀(渲染用)
  let rp = pts;
  if (rp.length > 40) rp = rp.filter((_, i) => i % Math.ceil(rp.length / 40) === 0);
  if (rp.length < 3) { skip.tiny++; continue; }

  const props = f.properties || {};
  const tags = {};
  const cls = (props.class_names || [])[0] || '';
  if (cls === 'commercial' || cls === 'office') tags.building = 'commercial';
  const lon0 = ringLL[0][0], lat0 = ringLL[0][1];
  let h = buildingH(featIdx, tags, lon0, lat0, area);
  if (area > 8000) h = Math.min(h, 24);
  if (area > 30000) h = Math.min(h, 15);

  // ④ 基座取 footprint 最低地形:坡地楼体下沉而非悬空
  let gy = Infinity;
  for (const p of rp) { const t = terrainHeight(p[0], p[1]); if (t < gy) gy = t; }
  gy = Math.max(gy, 0);

  const bk = bucketOf(tags, area);
  const B = buckets[bk];
  const fp = FACADE[bk];
  const fc = new THREE.Color(fp[(rand() * fp.length) | 0]).multiplyScalar(0.88 + rand() * 0.24);
  const rc = new THREE.Color(ROOFS[(rand() * ROOFS.length) | 0]).multiplyScalar(0.9 + rand() * 0.2);

  // 侧面
  let acc = 0;
  for (let i = 0; i < rp.length; i++) {
    const [x1, z1] = rp[i], [x2, z2] = rp[(i + 1) % rp.length];
    const len = Math.hypot(x2 - x1, z2 - z1);
    if (len < 0.05) continue;
    const nx = (z2 - z1) / len, nz = -(x2 - x1) / len;
    const u0 = acc / 3.5, u1 = (acc + len) / 3.5, v1 = h / 3.2;
    const vi = B.pos.length / 3;
    B.pos.push(x1, gy, z1, x2, gy, z2, x2, gy + h, z2, x1, gy + h, z1);
    B.nor.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
    B.uv.push(u0, 0, u1, 0, u1, v1, u0, v1);
    for (let k = 0; k < 4; k++) B.col.push(fc.r, fc.g, fc.b);
    B.idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
    acc += len;
  }
  // 屋顶
  let cx = 0, cz = 0;
  try {
    const contour = rp.map(([x, z]) => new THREE.Vector2(x, z));
    for (const p of contour) { cx += p.x; cz += p.y; }
    cx /= contour.length; cz /= contour.length;
    const tris = THREE.ShapeUtils.triangulateShape(contour, []);
    const vi = B.pos.length / 3;
    for (const p of contour) B.pos.push(p.x, gy + h, p.y);
    for (const p of contour) { B.nor.push(0, 1, 0); B.uv.push(p.x / 8, p.y / 8); B.col.push(rc.r, rc.g, rc.b); }
    for (const t of tris) B.idx.push(vi + t[0], vi + t[2], vi + t[1]);
  } catch { /* 自交跳过 */ }
  // 屋顶设备块
  if (area > 220 && h > 11 && rand() < 0.4) {
    const bh = 2.2 + rand() * 1.6, bw = Math.min(6, Math.sqrt(area) * 0.18);
    const q = [[-bw, -bw], [bw, -bw], [bw, bw], [-bw, bw]];
    const vb = [], vt = [];
    for (const [ox, oz] of q) { vb.push(B.pos.length / 3); B.pos.push(cx + ox, gy + h, cz + oz); B.nor.push(0, 1, 0); B.uv.push(0, 0); B.col.push(rc.r * 1.15, rc.g * 1.15, rc.b * 1.15); }
    for (const [ox, oz] of q) { vt.push(B.pos.length / 3); B.pos.push(cx + ox, gy + h + bh, cz + oz); B.nor.push(0, 1, 0); B.uv.push(0, 0); B.col.push(rc.r * 0.85, rc.g * 0.85, rc.b * 0.85); }
    B.idx.push(vb[0], vb[1], vb[2], vb[0], vb[2], vb[3]);
    B.idx.push(vt[2], vt[1], vt[0], vt[3], vt[2], vt[0]);
    for (let e = 0; e < 4; e++) {
      const a = e, b = (e + 1) % 4;
      B.idx.push(vb[a], vt[a], vt[b], vb[a], vt[b], vb[b]);
    }
  }

  // 碰撞 OBB(内缩 0.4 m,避免贴街楼体把车道判死)
  coll.push(obb.cx, obb.cz, Math.max(0.6, obb.hx - 0.4), Math.max(0.6, obb.hz - 0.4), obb.c, obb.s, gy + h);
  count++;
}

/* ---- 输出 ---- */
const metas = { buckets: {}, count, collision: coll.length / 7 };
const parts = [];
let offset = 0;
for (const [k, B] of Object.entries(buckets)) {
  if (!B.idx.length) continue;
  const pos = new Float32Array(B.pos), nor = new Float32Array(B.nor), uv = new Float32Array(B.uv);
  const col = new Uint8Array(B.col.length);
  for (let i = 0; i < B.col.length; i++) col[i] = Math.round(B.col[i] * 255);
  const idx = new Uint32Array(B.idx);
  // idx 起点 4 字节对齐:col 是 3B/顶点,末尾补零到 4 的倍数
  // (JS TypedArray 要求对齐,否则运行期 "start offset should be a multiple of 4")
  const pad = (4 - (col.byteLength % 4)) % 4;
  metas.buckets[k] = { offset, vCount: pos.length / 3, iCount: idx.length };
  parts.push(pos.buffer, nor.buffer, uv.buffer, col.buffer, new ArrayBuffer(pad), idx.buffer);
  offset += pos.byteLength + nor.byteLength + uv.byteLength + col.byteLength + pad + idx.byteLength;
}
const total = new Uint8Array(offset);
let o = 0;
for (const p of parts) { total.set(new Uint8Array(p), o); o += p.byteLength; }
writeFileSync(resolve(ROOT, 'data/city.bin'), total);
writeFileSync(resolve(ROOT, 'data/city-meta.json'), JSON.stringify(metas));
const collBuf = new Float32Array(coll);
writeFileSync(resolve(ROOT, 'data/city-collision.bin'), Buffer.from(collBuf.buffer));

console.log(`✓ 烘焙 ${count} 栋 → city.bin ${(offset / 1048576).toFixed(1)} MB`);
console.log(`✓ 碰撞盒 ${metas.collision} 个 → city-collision.bin ${(collBuf.byteLength / 1048576).toFixed(1)} MB`);
console.log(`  裁剪: 落水 ${skip.water} · 压路 ${skip.road} · 占地圆 ${skip.site} · 超大轮廓 ${skip.huge} · 面积 ${skip.area} · 几何 ${skip.geom + skip.tiny}`);

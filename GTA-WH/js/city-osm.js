// OSM 真实城市:建筑轮廓挤出 + 真实路网(data/osm/,Overpass ODbL)
// 建筑按 tags 分材质桶,挤出侧面(世界坐标 UV → 窗格立面)+ 屋顶三角化,合成 4 个大 Mesh
import * as THREE from 'three';
import { toV2, makeRandom, pointInPolygon } from './geo.js';
import { RIVER, LAKES } from './data.js';
import { mat, loadTexture, ribbonGeometry, registerEnv, makeFacadeTexture, makeWindowTexture } from './lib.js';
import { terrainHeight } from './world.js';

const RIVER_PTS_LNGLAT = RIVER.pts;
const LAKE_LNGLAT = LAKES.map((l) => l.pts);

/** 快速水域判定(lon/lat 域,粗查:点在江线折线带内或湖内) */
function wetLL(lon, lat) {
  // 长江/汉江:点到折线距离 < 半宽(度近似:0.006/0.0016)
  for (const [pts, hwDeg] of [[RIVER_PTS_LNGLAT, 0.0058], [RIVER.branches[0].pts, 0.0016]]) {
    for (let i = 1; i < pts.length; i++) {
      const [ax, aLat] = pts[i - 1], [bx, bLat] = pts[i];
      const dx = bx - ax, dLat = bLat - aLat;
      const l2 = dx * dx + dLat * dLat || 1e-12;
      let t = ((lon - ax) * dx + (lat - aLat) * dLat) / l2;
      t = Math.max(0, Math.min(1, t));
      if (Math.hypot(lon - ax - dx * t, lat - aLat - dLat * t) < hwDeg) return true;
    }
  }
  for (const lake of LAKE_LNGLAT) {
    let inside = false;
    for (let i = 0, j = lake.length - 1; i < lake.length; j = i++) {
      const [xi, yi] = lake[i], [xj, yj] = lake[j];
      if ((yi > lat) !== (yj > lat) && lon < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside;
    }
    if (inside) return true;
  }
  return false;
}

/** 多边形面积(鞋带,场景米)与抽稀 */
function polyArea(pts) {
  let a = 0;
  for (let i = 0, j = pts.length - 1; i < pts.length; j = i++) {
    a += pts[j][0] * pts[i][1] - pts[i][0] * pts[j][1];
  }
  return Math.abs(a / 2);
}
function thinPts(pts, maxVerts) {
  if (pts.length <= maxVerts) return pts;
  const step = Math.ceil(pts.length / maxVerts);
  const out = pts.filter((_, i) => i % step === 0);
  if (out[out.length - 1] !== pts[pts.length - 1]) out.push(pts[pts.length - 1]);
  return out;
}

/* ---------- 高度启发式 ---------- */
const CENTER_LNGLAT = [114.295, 30.560];
function buildingH(tags, lon, lat, rand) {
  const h = parseFloat(tags.height);
  if (Number.isFinite(h) && h > 2 && h < 640) return Math.min(h, 636);
  const lv = parseFloat(tags['building:levels'] ?? tags.levels);
  if (Number.isFinite(lv) && lv > 0) return Math.min(lv * 3.3 + 1.5, 636);
  // 无标签:距两江交汇核心距离衰减 + 噪声
  const d = Math.hypot((lon - CENTER_LNGLAT[0]) * 92, (lat - CENTER_LNGLAT[1]) * 111);
  const core = Math.max(0, 1 - d / 8000);                 // 8km 衰减
  const r = rand();
  const base = 9 + core * core * 46 + r * 14;
  return Math.min(base, 90);
}

/* ---------- 材质桶 ---------- */
function bucketOf(tags) {
  const b = tags.building || 'yes';
  if (['office', 'commercial', 'retail', 'hotel', 'supermarket', 'public'].includes(b)) return 'glass';
  if (['church', 'cathedral', 'temple', 'historic', 'civic', 'government'].includes(b)) return 'civic';
  if (['house', 'detached', 'bungalow', 'semidetached_house', 'terrace'].includes(b)) return 'lowrise';
  return 'concrete';
}

/**
 * 构建 OSM 真实城市
 * @param buildings [{t, g:[[lon,lat]…]}]
 * @returns { group, count }
 */
export async function buildOsmCity(buildings) {
  // 优先:构建期烘焙的 Overture 全量二进制(data/city.bin,零构建成本)
  try {
    const [bin, meta, collBin] = await Promise.all([
      fetch('./data/city.bin').then((r) => r.arrayBuffer()),
      fetch('./data/city-meta.json').then((r) => r.json()),
      fetch('./data/city-collision.bin').then((r) => r.arrayBuffer())
        .catch(() => null),      // 碰撞盒缺失降级为"无碰撞",不影响出图
    ]);
    const dv = new DataView(bin);
    let o = 0;
    const group = new THREE.Group();
    group.name = 'osm-city';
    const mats = {
      concrete: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: makeFacadeTexture(), normalMap: loadTexture('./assets/textures/rough_concrete_nor_gl_2k.jpg', { srgb: false }), emissiveMap: makeWindowTexture(), emissive: new THREE.Color('#ffc98a'), emissiveIntensity: 0, roughness: 0.6, metalness: 0.15, normalScale: new THREE.Vector2(0.5, 0.5) }),
      glass: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: makeFacadeTexture(), normalMap: loadTexture('./assets/textures/rough_concrete_nor_gl_2k.jpg', { srgb: false }), emissiveMap: makeWindowTexture(), emissive: new THREE.Color('#c8dcf0'), emissiveIntensity: 0, roughness: 0.25, metalness: 0.55, normalScale: new THREE.Vector2(0.3, 0.3) }),
      civic: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: makeFacadeTexture(), emissiveMap: makeWindowTexture(), emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 0, roughness: 0.85, metalness: 0.05 }),
      lowrise: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: loadTexture('./assets/textures/brick_diffuse.jpg') || makeFacadeTexture(), emissiveMap: makeWindowTexture(), emissive: new THREE.Color('#ffc98a'), emissiveIntensity: 0, roughness: 0.9, metalness: 0.02 }),
    };
    for (const m of Object.values(mats)) registerEnv(m, 0.7);
    const matList = Object.values(mats);
    for (const [k, b] of Object.entries(meta.buckets)) {
      const v = b.vCount, ni = b.iCount;
      const pos = new Float32Array(bin, o, v * 3); o += v * 12;
      const nor = new Float32Array(bin, o, v * 3); o += v * 12;
      const uv = new Float32Array(bin, o, v * 2); o += v * 8;
      const col = new Uint8Array(bin, o, v * 3); o += v * 3;
      o = (o + 3) & ~3;                     // idx 起点 4 字节对齐(烘焙器在 col 后补零)
      const idx = new Uint32Array(bin, o, ni); o += ni * 4;
      const geo = new THREE.BufferGeometry();
      geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
      geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
      geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      geo.setAttribute('color', new THREE.BufferAttribute(col, 3, true));
      geo.setIndex(new THREE.BufferAttribute(idx, 1));
      geo.computeBoundingSphere();
      const mesh = new THREE.Mesh(geo, mats[k]);
      mesh.name = 'bake:' + k;
      mesh.castShadow = true;
      mesh.receiveShadow = true;
      mesh.material.side = THREE.DoubleSide;
      group.add(mesh);
    }
    const boxes = collBin ? new Float32Array(collBin) : null;
    console.log(`[GTA-WH] 烘焙城市: ${meta.count} 栋(Overture,零拷贝),碰撞盒 ${boxes ? boxes.length / 7 : 0} 个`);
    return {
      group, count: meta.count, mats: matList, boxes,
      setNight(kk) { for (const m of matList) m.emissiveIntensity = kk * 0.85; },
    };
  } catch (e) {
    console.warn('[GTA-WH] city.bin 不可用,回退 OSM JSON 挤出:', e.message);
  }
  const rand = makeRandom(20261003);
  const facade = makeFacadeTexture();
  const windowsTex = makeWindowTexture();
  const brick = loadTexture('./assets/textures/brick_diffuse.jpg');
  const concNor = loadTexture('./assets/textures/rough_concrete_nor_gl_2k.jpg', { srgb: false });
  const concRough = loadTexture('./assets/textures/rough_concrete_rough_2k.jpg', { srgb: false });

  const buckets = {
    concrete: { pos: [], nor: [], uv: [], idx: [], col: [] },
    glass: { pos: [], nor: [], uv: [], idx: [], col: [] },
    civic: { pos: [], nor: [], uv: [], idx: [], col: [] },
    lowrise: { pos: [], nor: [], uv: [], idx: [], col: [] },
  };
  // 城市色彩系统:立面真实色板 + 深色屋顶系(告别白模)
  const FACADE_PALETTE = {
    concrete: ['#cfcabb', '#c2bbab', '#b6b2a4', '#d6cec0', '#aca69a', '#bdb3a0'],
    glass: ['#8fa8bc', '#7d9cb4', '#a3b8c6', '#6f92aa', '#88a2b8'],
    civic: ['#d8cfc0', '#cfc4b2', '#c2b49e', '#d4c8b4'],
    lowrise: ['#c4917a', '#b5836e', '#cf9d86', '#a87862', '#d0a184'],
  };
  const ROOF_PALETTE = ['#565a60', '#6b6560', '#75706a', '#4e5560', '#7d766e', '#5f6168', '#8a8378'];
  const materials = {
    concrete: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: facade, normalMap: concNor, roughnessMap: concRough, emissiveMap: windowsTex, emissive: new THREE.Color('#ffc98a'), emissiveIntensity: 0, roughness: 0.6, metalness: 0.15, normalScale: new THREE.Vector2(0.5, 0.5) }),
    glass: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: facade, normalMap: concNor, emissiveMap: windowsTex, emissive: new THREE.Color('#c8dcf0'), emissiveIntensity: 0, roughness: 0.25, metalness: 0.55, normalScale: new THREE.Vector2(0.3, 0.3) }),
    civic: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: facade, emissiveMap: windowsTex, emissive: new THREE.Color('#ffd9a0'), emissiveIntensity: 0, roughness: 0.85, metalness: 0.05 }),
    lowrise: new THREE.MeshStandardMaterial({ color: 0xffffff, vertexColors: true, map: brick || facade, emissiveMap: windowsTex, emissive: new THREE.Color('#ffc98a'), emissiveIntensity: 0, roughness: 0.9, metalness: 0.02 }),
  };
  for (const m of Object.values(materials)) registerEnv(m, 0.7);

  let count = 0;
  const coll = [];          // 回退路径的碰撞盒(AABB 近似,stride 7)
  for (const b of buildings) {
    const g = b.g;
    if (!g || g.length < 4) continue;
    // 闭合
    let ring = g.slice();
    const first = ring[0], last = ring[ring.length - 1];
    if (Math.abs(first[0] - last[0]) > 1e-6 || Math.abs(first[1] - last[1]) > 1e-6) ring.push(first.slice());
    if (ring.length < 4) continue;
    // 水上建筑跳过(轮渡码头等)
    if (wetLL(g[0][0], g[0][1])) continue;
    // 投影
    const pts = thinPts(ring.map(([lon, lat]) => toV2(lon, lat)), 40);
    if (pts.length < 4) continue;
    const area = polyArea(pts.slice(0, -1));
    if (area < 25 || area > 90000) continue;
    // 高度(大底面压低:厂房/商场)
    let h = buildingH(b.t || {}, g[0][0], g[0][1], rand);
    if (area > 8000) h = Math.min(h, 24);
    if (area > 30000) h = Math.min(h, 15);

    const gy = Math.max(terrainHeight(pts[0][0], pts[0][1]), 0);
    const bk = bucketOf(b.t || {});
    const B = buckets[bk];
    // 本建筑色彩(立面桶色板 × 明度微差;屋顶深色系)
    const fp = FACADE_PALETTE[bk];
    const fc = new THREE.Color(fp[(rand() * fp.length) | 0]).multiplyScalar(0.88 + rand() * 0.24);
    const rc = new THREE.Color(ROOF_PALETTE[(rand() * ROOF_PALETTE.length) | 0]).multiplyScalar(0.9 + rand() * 0.2);

    // 侧面:每边一 Quad,UV 按世界尺寸(u=累计长/3.5m 一格,v=h/3.2 一层)
    let acc = 0;
    for (let i = 0; i < pts.length - 1; i++) {
      const [x1, z1] = pts[i], [x2, z2] = pts[i + 1];
      const len = Math.hypot(x2 - x1, z2 - z1);
      if (len < 0.05) continue;
      const nx = (z2 - z1) / len, nz = -(x2 - x1) / len;   // 外法线(取决于环绕方向,双面渲染兜底)
      const u0 = acc / 3.5, u1 = (acc + len) / 3.5, v1 = h / 3.2;
      const vi = B.pos.length / 3;
      B.pos.push(x1, gy, z1, x2, gy, z2, x2, gy + h, z2, x1, gy + h, z1);
      B.nor.push(nx, 0, nz, nx, 0, nz, nx, 0, nz, nx, 0, nz);
      B.uv.push(u0, 0, u1, 0, u1, v1, u0, v1);
      for (let k = 0; k < 4; k++) B.col.push(fc.r, fc.g, fc.b);
      B.idx.push(vi, vi + 1, vi + 2, vi, vi + 2, vi + 3);
      acc += len;
    }
    // 屋顶:三角化(three ShapeUtils)+ 深色屋顶顶点色 + 设备块
    let cx = 0, cz = 0;
    const roofRing = pts.slice(0, -1);
    try {
      const contour = roofRing.map(([x, z]) => new THREE.Vector2(x, z));
      for (const p of contour) { cx += p.x; cz += p.y; }
      cx /= contour.length; cz /= contour.length;
      const tris = THREE.ShapeUtils.triangulateShape(contour, []);
      const vi = B.pos.length / 3;
      for (const p of contour) B.pos.push(p.x, gy + h, p.y);
      for (let i = 0; i < contour.length; i++) {
        B.nor.push(0, 1, 0);
        B.uv.push(contour[i].x / 8, contour[i].y / 8);
        B.col.push(rc.r, rc.g, rc.b);
      }
      for (const t of tris) B.idx.push(vi + t[0], vi + t[2], vi + t[1]);
    } catch { /* 自交多边形跳过屋顶 */ }
    // 碰撞盒(AABB)
    {
      let a0 = Infinity, a1 = -Infinity, b0 = Infinity, b1 = -Infinity;
      for (const [px, pz] of pts) {
        if (px < a0) a0 = px; if (px > a1) a1 = px;
        if (pz < b0) b0 = pz; if (pz > b1) b1 = pz;
      }
      coll.push((a0 + a1) / 2, (b0 + b1) / 2, Math.max(0.6, (a1 - a0) / 2 - 0.4), Math.max(0.6, (b1 - b0) / 2 - 0.4), 1, 0, gy + h);
    }
    // 屋顶设备块(机房/水箱):中大型建筑 40%
    if (area > 220 && h > 11 && rand() < 0.4) {
      const bh = 2.2 + rand() * 1.6, bw = Math.min(6, Math.sqrt(area) * 0.18);
      const q = [[-bw, -bw], [bw, -bw], [bw, bw], [-bw, bw]];
      const vBottom = [], vTop = [];
      for (const [ox, oz] of q) {
        vBottom.push(B.pos.length / 3);
        B.pos.push(cx + ox, gy + h, cz + oz);
        B.nor.push(0, 1, 0); B.uv.push(0, 0);
        B.col.push(rc.r * 1.15, rc.g * 1.15, rc.b * 1.15);
      }
      for (const [ox, oz] of q) {
        vTop.push(B.pos.length / 3);
        B.pos.push(cx + ox, gy + h + bh, cz + oz);
        B.nor.push(0, 1, 0); B.uv.push(0, 0);
        B.col.push(rc.r * 0.85, rc.g * 0.85, rc.b * 0.85);
      }
      B.idx.push(vBottom[0], vBottom[1], vBottom[2], vBottom[0], vBottom[2], vBottom[3]);
      B.idx.push(vTop[2], vTop[1], vTop[0], vTop[3], vTop[2], vTop[0]);
      for (let e = 0; e < 4; e++) {
        const a = e, b2 = (e + 1) % 4;
        B.idx.push(vBottom[a], vTop[a], vTop[b2], vBottom[a], vTop[b2], vBottom[b2]);
      }
    }
    count++;
  }

  const group = new THREE.Group();
  group.name = 'osm-city';
  for (const [key, B] of Object.entries(buckets)) {
    if (!B.idx.length) continue;
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.Float32BufferAttribute(B.pos, 3));
    geo.setAttribute('normal', new THREE.Float32BufferAttribute(B.nor, 3));
    geo.setAttribute('uv', new THREE.Float32BufferAttribute(B.uv, 2));
    geo.setAttribute('color', new THREE.Float32BufferAttribute(B.col, 3));
    geo.setIndex(B.idx);
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, materials[key]);
    mesh.name = 'osm:' + key;
    mesh.castShadow = true;
    mesh.receiveShadow = true;
    mesh.material.side = THREE.DoubleSide;   // OSM 轮廓环绕方向不定,侧面双面
    group.add(mesh);
  }
  return {
    group, count, boxes: new Float32Array(coll),
    setNight(k) {
      for (const m of Object.values(materials)) m.emissiveIntensity = k * 0.85;
    },
  };
}

/* ---------- OSM 路网 ----------
 * 旧版宽度整体偏大(如 motorway 48 m),路面带常压进沿街楼体 → "路穿楼";
 * 按车道数+硬路肩的真实口径收窄。 */
const HW_W = { motorway: 40, trunk: 34, trunk_link: 16, primary: 28, primary_link: 14, secondary: 22, secondary_link: 12, tertiary: 16, tertiary_link: 10 };

export function buildOsmRoads(roads) {
  const group = new THREE.Group();
  group.name = 'osm-roads';
  const centerlines = [];
  const mats = {
    major: mat('#46494e', { rough: 0.94, env: 0.2 }),
    minor: mat('#4d5055', { rough: 0.95, env: 0.18 }),
  };
  const geoms = { major: [], minor: [] };
  for (const r of roads) {
    const hw = r.t?.highway;
    if (!hw || !(hw in HW_W)) continue;
    if (r.t?.tunnel) continue;                          // 隧道不画
    const w = HW_W[hw];
    const pts = r.g.map(([lon, lat]) => toV2(lon, lat));
    if (pts.length < 2) continue;
    const cls = (hw.startsWith('trunk') || hw.startsWith('primary')) ? 'major' : 'minor';
    // 贴地:桥 tag 抬 6.5m;贴水无桥段抬堤 1.1m(向邻点平滑);其余贴地形
    const isBridge = !!r.t?.bridge;
    const wet = pts.map((_, i) => (isBridge ? 0 : (wetLL(r.g[i][0], r.g[i][1]) ? 1 : 0)));
    for (let pass = 0; pass < 3; pass++) {
      const w2 = wet.slice();
      for (let i = 0; i < wet.length; i++) {
        const a = wet[i - 1] ?? 0, b = wet[i], c = wet[i + 1] ?? 0;
        w2[i] = Math.max(b, (a + b + c) / 3);
      }
      for (let i = 0; i < wet.length; i++) wet[i] = Math.min(1, w2[i]);
    }
    const ys = pts.map(([x, z], i) => {
      const th = Math.max(terrainHeight(x, z), 0);
      return isBridge ? Math.max(th, 6.5) : th + wet[i] * 0.95;
    });
    const geo = ribbonGeometry(pts, w, 0);
    const p = geo.attributes.position;
    for (let i = 0; i < p.count; i++) p.setY(i, ys[Math.min(ys.length - 1, Math.floor(i / 2))] + 0.18);
    geo.computeVertexNormals();
    geoms[cls].push(geo);
    if (w >= 16) centerlines.push({ name: r.t?.name || 'osm-road', w, pts, ys, major: cls === 'major' });
  }
  for (const [cls, list] of Object.entries(geoms)) {
    if (!list.length) continue;
    // 合并同材质路网
    let vp = 0, vi = 0;
    for (const g of list) vp += g.attributes.position.count;
    const pos = new Float32Array(vp * 3), uv = new Float32Array(vp * 2), nor = new Float32Array(vp * 3);
    const idx = new Uint32Array(vp * 3);
    let po = 0, io = 0;
    for (const g of list) {
      const p = g.attributes.position, n = g.attributes.normal, u = g.attributes.uv, ix = g.index.array;
      for (let i = 0; i < p.count; i++) {
        const o3 = (po + i) * 3, o2 = (po + i) * 2;
        pos[o3] = p.getX(i); pos[o3 + 1] = p.getY(i); pos[o3 + 2] = p.getZ(i);
        nor[o3] = n.getX(i); nor[o3 + 1] = n.getY(i); nor[o3 + 2] = n.getZ(i);
        uv[o2] = u.getX(i); uv[o2 + 1] = u.getY(i);
      }
      for (let i = 0; i < ix.length; i++) idx[io + i] = ix[i] + po;
      po += p.count; io += ix.length;
    }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
    geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
    geo.setIndex(new THREE.BufferAttribute(idx.subarray(0, io), 1));
    geo.computeBoundingSphere();
    const mesh = new THREE.Mesh(geo, mats[cls]);
    mesh.name = 'osm-roads:' + cls;
    mesh.receiveShadow = true;
    group.add(mesh);
  }
  return { group, centerlines };
}

/** OSM 覆盖范围(供程序化城市避让),lon/lat 框 */
export const OSM_BOX = { lon0: 114.220, lat0: 30.500, lon1: 114.420, lat1: 30.640 };

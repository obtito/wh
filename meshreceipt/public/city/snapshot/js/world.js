// 世界层:地面 / 山体 / 水面(长江·汉江·东湖水系) / 道路网
// 山体:旋转椭圆 + fbm 粗糙度的高度场(参考 GTA-NJ world.js,米制适配)
import * as THREE from 'three';
import {
  toV2, toV2List, fbm, noise2, clamp, smoothPolyline, resample,
} from './geo.js';
import { LAKES, MOUNTAINS, ROADS } from './data.js';
import { mat, ribbonGeometry, polygonGeometry, makeGroundTexture, registerEnv } from './lib.js';
import { whuGroundGrade } from './whu-layout.js';

import { RIVER_SURFACE_POINTS, BRANCH_SURFACES, yangtzeWidth, footprintOverlapsWater } from './water-mask.js';

/* ==================== 高度场 ==================== */

const mountainInfo = MOUNTAINS.map((m, i) => {
  const [x, z] = toV2(m.lon, m.lat);
  const rot = (m.rot || 0) * Math.PI / 180;
  return { ...m, x, z, rot, seed: 71 + i * 13 };
});

/** 山体影响下的地面高度(米)。基地面 = 0,水 = 0.5。 */
export function terrainHeight(x, z) {
  let h = 0;
  for (const m of mountainInfo) {
    // 旋转到椭圆局部坐标
    const dx0 = x - m.x, dz0 = z - m.z;
    const c = Math.cos(-m.rot), s = Math.sin(-m.rot);
    const dx = (dx0 * c - dz0 * s) / m.rx;
    const dz = (dx0 * s + dz0 * c) / m.rz;
    const r = Math.sqrt(dx * dx + dz * dz);
    if (r >= 1) continue;
    const fall = Math.pow(Math.cos((r * Math.PI) / 2), 1.7);
    const rough = 0.66 + 0.6 * fbm(x * 0.004, z * 0.004, 4, m.seed) * (m.rough ?? 0.5);
    const detail = 0.92 + 0.14 * noise2(x * 0.02, z * 0.02, m.seed + 5);
    h += fall * rough * detail * m.h;
  }
  return whuGroundGrade(x,z,h);
}

export function mountains() { return mountainInfo; }

/* ==================== 地面 ==================== */

export function buildGround() {
  const g = new THREE.PlaneGeometry(32000, 26000, 1, 1).rotateX(-Math.PI / 2);
  const tex = makeGroundTexture(430);
  const m = new THREE.MeshStandardMaterial({ color: 0xb6c0a2, roughness: 1, metalness: 0, map: tex });
  registerEnv(m, 0.45);
  const mesh = new THREE.Mesh(g, m);
  mesh.position.y = 0;
  mesh.receiveShadow = true;
  mesh.name = 'ground';
  return { mesh, mat: m };
}

/* ==================== 山体 ==================== */

const MOUNTAIN_SEGMENTS = 72;
const mountainGeometryCache = new Map();

/** Exact indexed surface used by the renderer; consumers must not mutate this geometry. */
export function mountainSurfaceGeometry(id) {
  if (mountainGeometryCache.has(id)) return mountainGeometryCache.get(id);
  const mo = mountainInfo.find(m => m.id === id);
  if (!mo) throw new Error(`Unknown mountain surface: ${id}`);
  const sizeX = mo.rx * 2.3, sizeZ = mo.rz * 2.3;
  const seg = MOUNTAIN_SEGMENTS;
  const geo = new THREE.PlaneGeometry(sizeX, sizeZ, seg, seg).rotateX(-Math.PI / 2);
  geo.rotateY(mo.rot);
  geo.translate(mo.x, 0, mo.z);
  const pos = geo.attributes.position;
  const colors = new Float32Array(pos.count * 3);
  const low = new THREE.Color('#4d6e3f'), mid = new THREE.Color('#3c5c31'), high = new THREE.Color('#6d6754');
  let maxH = 0;
  for (let i = 0; i < pos.count; i++) {
    let h = terrainHeight(pos.getX(i), pos.getZ(i));
    // 裙边下压:与地面 y=0 共面会 z-fighting 闪烁,裙边沉到地下
    if (h < 0.05) h = -0.4;
    pos.setY(i, h);
    maxH = Math.max(maxH, h);
  }
  for (let i = 0; i < pos.count; i++) {
    const t = clamp(pos.getY(i) / (maxH || 1), 0, 1);
    const c = t < 0.72
      ? low.clone().lerp(mid, t / 0.72)
      : mid.clone().lerp(high, (t - 0.72) / 0.28);
    colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
  }
  geo.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  geo.computeVertexNormals();
  mountainGeometryCache.set(id, geo);
  return geo;
}

/** Visible ground height, interpolated on the same Float32 triangles as the mountain meshes. */
export function terrainSurfaceHeight(x, z) {
  let height = 0;
  for (const mo of mountainInfo) {
    const c = Math.cos(mo.rot), s = Math.sin(mo.rot), dx = x - mo.x, dz = z - mo.z;
    const u = ((dx*c-dz*s)/(mo.rx*2.3)+.5)*MOUNTAIN_SEGMENTS;
    const v = ((dx*s+dz*c)/(mo.rz*2.3)+.5)*MOUNTAIN_SEGMENTS;
    if (u < 0 || v < 0 || u >= MOUNTAIN_SEGMENTS || v >= MOUNTAIN_SEGMENTS) continue;
    const geometry = mountainSurfaceGeometry(mo.id), p = geometry.attributes.position, index = geometry.index;
    const first = (Math.floor(v)*MOUNTAIN_SEGMENTS+Math.floor(u))*6;
    for (let t=0;t<2;t++) {
      const a=index.getX(first+t*3),b=index.getX(first+t*3+1),d=index.getX(first+t*3+2);
      const ax=p.getX(a),az=p.getZ(a),bx=p.getX(b),bz=p.getZ(b),cx=p.getX(d),cz=p.getZ(d);
      const determinant=(bz-cz)*(ax-cx)+(cx-bx)*(az-cz);
      const wa=((bz-cz)*(x-cx)+(cx-bx)*(z-cz))/determinant;
      const wb=((cz-az)*(x-cx)+(ax-cx)*(z-cz))/determinant, wc=1-wa-wb;
      // A small tolerance accounts for Float32 world coordinates along a grid edge.
      if (wa>=-1e-4 && wb>=-1e-4 && wc>=-1e-4) height=Math.max(height,wa*p.getY(a)+wb*p.getY(b)+wc*p.getY(d));
    }
  }
  return height;
}

export function buildMountains() {
  const group = new THREE.Group();
  group.name = 'mountains';
  for (const mo of mountainInfo) {
    const geo = mountainSurfaceGeometry(mo.id);
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true, side: THREE.DoubleSide,
    });
    registerEnv(material, 0.35);
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    mesh.name = `mountain:${mo.id}`;
    group.add(mesh);
  }
  return group;
}

/* ==================== 水面 ==================== */

export function createWaterMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
    // The river is only 0.5 m above a city-sized ground plane. Preserve its
    // depth ordering at shallow bridge-view angles without disabling occlusion.
    polygonOffset: true,
    polygonOffsetFactor: -1,
    polygonOffsetUnits: -1,
    uniforms: THREE.UniformsUtils.merge([
      THREE.UniformsLib.fog,
      {
        uTime: { value: 0 },
        uNight: { value: 0 },
        uDeep: { value: new THREE.Color('#39697f') },      // 长江水偏黄绿
        uShallow: { value: new THREE.Color('#6f9d88') },
        uSky: { value: new THREE.Color('#bcd6e8') },
        uHorizon: { value: new THREE.Color('#cfe0ec') },
        uZenith: { value: new THREE.Color('#4d82c4') },
        uSunI: { value: 1 },
        uSunDir: { value: new THREE.Vector3(0.4, 0.8, 0.3) },
      },
    ]),
    vertexShader: /* glsl */`
      #include <common>
      #include <fog_pars_vertex>
      varying vec3 vWorld;
      void main() {
        vec4 world = modelMatrix * vec4(position, 1.0);
        vWorld = world.xyz;
        vec4 mvPosition = viewMatrix * world;
        gl_Position = projectionMatrix * mvPosition;
        #include <fog_vertex>
      }
    `,
    fragmentShader: /* glsl */`
      #include <common>
      #include <fog_pars_fragment>
      uniform float uTime, uNight, uSunI;
      uniform vec3 uDeep, uShallow, uSky, uSunDir, uHorizon, uZenith;
      varying vec3 vWorld;

      vec3 skyGrad(vec3 dir) {
        float t = clamp(dir.y * 0.5 + 0.5, 0.0, 1.0);
        return mix(uHorizon, uZenith, pow(t, 0.7));
      }

      float wave(vec2 p, float t) {
        float w = sin(p.x * 0.28 + t * 0.5) * 0.5;          // ~22 m 细波
        w += sin(p.y * 0.22 - t * 0.4) * 0.5;
        w += sin((p.x + p.y) * 0.045 + t * 0.22) * 0.35;    // ~140 m 长涌
        w += sin((p.x - p.y * 0.7) * 0.5 - t * 0.8) * 0.12;
        return w;
      }

      void main() {
        float t = uTime;
        float e = 1.2;
        float h  = wave(vWorld.xz, t);
        float hx = wave(vWorld.xz + vec2(e, 0.0), t);
        float hz = wave(vWorld.xz + vec2(0.0, e), t);
        vec3 N = normalize(vec3(-(hx - h) / e * 0.5, 1.0, -(hz - h) / e * 0.5));
        vec3 V = normalize(cameraPosition - vWorld);
        vec3 L = normalize(uSunDir);

        float fres = pow(1.0 - clamp(dot(N, V), 0.0, 1.0), 3.2);
        vec3 base = mix(uDeep, uShallow, clamp(h * 0.2 + 0.45, 0.0, 1.0));
        vec3 R = reflect(-V, N);
        vec3 refl = mix(skyGrad(R), uSky, 0.35);
        base = mix(base, refl, fres * 0.85);

        float spec = pow(clamp(dot(R, L), 0.0, 1.0), 120.0) * 1.6;
        float glitter = pow(clamp(dot(normalize(vec3(N.x, 0.9, N.z)), L), 0.0, 1.0), 8.0) * 0.10;
        float glint = pow(clamp(dot(R, L), 0.0, 1.0), 900.0) * uSunI * 8.0;

        vec3 col = base + spec * (1.0 - uNight * 0.75) + glitter + glint * (1.0 - uNight);
        col *= mix(1.0, 0.30, uNight);
        col = mix(col, col * vec3(0.72, 0.80, 1.0) + vec3(0.012, 0.02, 0.05), uNight);

        gl_FragColor = vec4(col, 1.0);
        #include <tonemapping_fragment>
        #include <colorspace_fragment>
        #include <fog_fragment>
      }
    `,
  });
}

/** 长江宽度沿程:鹦鹉洲段收窄,龙王庙交汇段最阔,天兴洲段再阔 */
export function buildWater(material) {
  const group = new THREE.Group();
  group.name = 'water';

  // 主江:河床暗带(略宽) + 水面
  const pts = RIVER_SURFACE_POINTS;
  const bed = new THREE.Mesh(ribbonGeometry(pts, (t) => yangtzeWidth(t) + 60, 0.18), mat('#5d6650', { rough: 1 }));
  group.add(bed);
  const river = new THREE.Mesh(ribbonGeometry(pts, yangtzeWidth, 0.5), material);
  river.name = 'river';
  group.add(river);

  for (const br of BRANCH_SURFACES) {
    const bp = br.points;
    const bedB = new THREE.Mesh(ribbonGeometry(bp, br.halfWidth * 2 + 24, 0.18), mat('#5d6650', { rough: 1 }));
    group.add(bedB);
    const bm = new THREE.Mesh(ribbonGeometry(bp, br.halfWidth * 2, 0.5), material);
    bm.name = 'branch:' + (br.name || '支流');
    group.add(bm);
  }

  for (const lake of LAKES) {
    const poly = toV2List(lake.pts);
    const bedG = polygonGeometry(poly.map(([x, z]) => [x, z]), 0.18);
    group.add(new THREE.Mesh(bedG, mat('#5d6650', { rough: 1 })));
    const g = polygonGeometry(poly, 0.5);
    const m = new THREE.Mesh(g, material);
    m.name = 'lake:' + lake.name;
    group.add(m);
  }
  return group;
}

/* ==================== 道路 ==================== */

// 可见路面走廊注册表：渲染路面、车辆落点和水域判定共用同一组有效路段。
const ROAD_DECKS = [];
/** 重新注册可通行路段，包含坡道路面的实际高度。 */
export function registerRoadDecks(lines) {
  ROAD_DECKS.length = 0;
  for (const l of lines) {
    const xs = l.pts.map(p => p[0]), zs = l.pts.map(p => p[1]);
    ROAD_DECKS.push({ ...l, minX: Math.min(...xs), maxX: Math.max(...xs), minZ: Math.min(...zs), maxZ: Math.max(...zs) });
  }
}
export function roadHeightAt(x, z, entityY = Infinity) {
  let best = Infinity, height = null;
  for (const d of ROAD_DECKS) {
    if (x < d.minX - d.w || x > d.maxX + d.w || z < d.minZ - d.w || z > d.maxZ + d.w) continue;
    for (let i = 1; i < d.pts.length; i++) {
      const [ax, az] = d.pts[i - 1], [bx, bz] = d.pts[i];
      const dx = bx - ax, dz = bz - az, l2 = dx * dx + dz * dz;
      const t = l2 ? clamp(((x - ax) * dx + (z - az) * dz) / l2, 0, 1) : 0;
      const dist = (x - ax - dx * t) ** 2 + (z - az - dz * t) ** 2;
      const y = d.ys[i - 1] + (d.ys[i] - d.ys[i - 1]) * t;
      if (dist <= (d.w / 2) ** 2 && dist < best && (!d.bridge || entityY > y - 2.5)) { best = dist; height = y; }
    }
  }
  return height;
}

/** 返回 { group, centerlines } —— centerlines 供车流/寻路使用 */
export function buildRoads() {
  const group = new THREE.Group();
  group.name = 'roads';
  const centerlines = [];
  for (const r of ROADS) {
    const pts = resample(smoothPolyline(toV2List(r.pts), 6), 8);
    const geo = ribbonGeometry(pts, r.w, 0), p = geo.attributes.position;
    const ys = pts.map(([x, z], i) => Math.max(0, terrainHeight(x, z),
      terrainHeight(p.getX(i * 2), p.getZ(i * 2)), terrainHeight(p.getX(i * 2 + 1), p.getZ(i * 2 + 1))) + 0.18);
    for (let i = 0; i < pts.length; i++) { p.setY(i * 2, ys[i]); p.setY(i * 2 + 1, ys[i]); }
    const indices = [];
    let start = -1;
    for (let i = 0; i < pts.length - 1; i++) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      const poly = [a, b, d, c].map(v => [p.getX(v), p.getZ(v)]);
      const safe = !footprintOverlapsWater(poly);
      if (safe) { indices.push(a, c, b, b, c, d); if (start < 0) start = i; }
      if (!safe || i === pts.length - 2) {
        const end = safe ? i + 1 : i;
        if (start >= 0 && end > start) centerlines.push({ name: r.name, w: r.w, pts: pts.slice(start, end + 1), ys: ys.slice(start, end + 1), major: !!r.major });
        start = -1;
      }
    }
    if (!indices.length) { geo.dispose(); continue; }
    geo.setIndex(indices); geo.computeVertexNormals();
    const mesh = new THREE.Mesh(geo, asphaltMatCache());
    mesh.receiveShadow = true; group.add(mesh);
    if (r.w >= 24) {
      const dash = ribbonGeometry(pts, 0.4, 0), dp = dash.attributes.position;
      for (let i = 0; i < pts.length; i++) { dp.setY(i * 2, ys[i] + 0.14); dp.setY(i * 2 + 1, ys[i] + 0.14); }
      dash.setIndex(indices); dash.computeVertexNormals();
      group.add(new THREE.Mesh(dash, dashMatCache()));
    }
  }
  registerRoadDecks(centerlines);
  return { group, centerlines };
}

let _asphalt, _dash;
function asphaltMatCache() {
  if (!_asphalt) _asphalt = mat('#4a4d52', { rough: 0.94, env: 0.2 });
  return _asphalt;
}
function dashMatCache() {
  if (!_dash) _dash = mat('#d8d8ce', { rough: 0.7, emissive: '#3a3a32', emissiveIntensity: 0.25 });
  return _dash;
}

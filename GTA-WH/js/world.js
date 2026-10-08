// 世界层:地面 / 山体 / 水面(长江·汉江·东湖水系) / 道路网
// 山体:旋转椭圆 + fbm 粗糙度的高度场(参考 GTA-NJ world.js,米制适配)
import * as THREE from 'three';
import {
  toV2, toV2List, fbm, noise2, clamp, pointInPolygon, distToPolyline, smoothPolyline, resample, smoothstep as smooth,
} from './geo.js';
import { RIVER, LAKES, MOUNTAINS, ROADS } from './data.js';
import { mat, ribbonGeometry, polygonGeometry, makeGroundTexture, registerEnv } from './lib.js';

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
  return h;
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

export function buildMountains() {
  const group = new THREE.Group();
  group.name = 'mountains';
  for (const mo of mountainInfo) {
    const sizeX = mo.rx * 2.3, sizeZ = mo.rz * 2.3;
    const seg = 72;
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
    const material = new THREE.MeshStandardMaterial({
      color: 0xffffff, roughness: 1, metalness: 0, vertexColors: true, side: THREE.DoubleSide,
    });
    registerEnv(material, 0.35);
    const mesh = new THREE.Mesh(geo, material);
    mesh.receiveShadow = true;
    mesh.castShadow = false;
    group.add(mesh);
  }
  return group;
}

/* ==================== 水面 ==================== */

export function createWaterMaterial() {
  return new THREE.ShaderMaterial({
    fog: true,
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
function yangtzeWidth(t) {
  const base = RIVER.halfWidth * 2;             // 1120 m
  return base * (
    0.82
    + 0.30 * Math.sin(Math.PI * clamp(t, 0, 1))                        // 中段(交汇附近)更阔
    - 0.12 * Math.exp(-Math.pow((t - 0.33) / 0.06, 2))                 // 鹦鹉洲段收窄
    + 0.06 * Math.sin(t * 21)
  );
}

export function buildWater(material) {
  const group = new THREE.Group();
  group.name = 'water';

  // 主江:河床暗带(略宽) + 水面
  const pts = smoothPolyline(toV2List(RIVER.pts), 8);
  const bed = new THREE.Mesh(ribbonGeometry(pts, (t) => yangtzeWidth(t) + 60, 0.18), mat('#5d6650', { rough: 1 }));
  group.add(bed);
  const river = new THREE.Mesh(ribbonGeometry(pts, yangtzeWidth, 0.5), material);
  river.name = 'river';
  group.add(river);

  for (const br of RIVER.branches) {
    const bp = smoothPolyline(toV2List(br.pts), 8);
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

// 路面走廊注册表(供 ground.js 判定"堤式道路":贴江道路在水面上方行驶)
const ROAD_DECKS = [];
/** 堤式道路高度(x,z 在路面走廊内时返回路面高度,否则 null) */
export function roadHeightAt(x, z) {
  for (const d of ROAD_DECKS) {
    if (x < d.minX - 40 || x > d.maxX + 40 || z < d.minZ - 40 || z > d.maxZ + 40) continue;
    if (distToPolyline(x, z, d.pts) < d.w / 2 + 4) {
      // 最近采样点的高度
      let best = Infinity, bi = 0;
      for (let i = 0; i < d.pts.length; i++) {
        const dd = Math.hypot(x - d.pts[i][0], z - d.pts[i][1]);
        if (dd < best) { best = dd; bi = i; }
      }
      return d.ys[bi];
    }
  }
  return null;
}

/** 返回 { group, centerlines } —— centerlines 供车流/寻路使用 */
export function buildRoads() {
  const group = new THREE.Group();
  group.name = 'roads';
  const centerlines = [];
  const bedMat = mat('#6a6a5c', { rough: 1 });       // 路基(穿水段可见的堤)

  for (const r of ROADS) {
    const raw = toV2List(r.pts);
    const smoothPts = smoothPolyline(raw, 6);
    const pts = resample(smoothPts, 30);

    // 逐点判定是否在水上 → 抬成堤式路(向邻点平滑过渡,避免断坎)
    const wet = pts.map(([x, z]) => isWaterXY(x, z) ? 1 : 0);
    // 3 轮邻域扩散:水面段向两端各渐变 ~3 个采样点(90 m)
    for (let pass = 0; pass < 3; pass++) {
      const w2 = wet.slice();
      for (let i = 0; i < wet.length; i++) {
        const a = wet[i - 1] ?? 0, b = wet[i], c = wet[i + 1] ?? 0;
        w2[i] = Math.max(b, (a + b + c) / 3);
      }
      for (let i = 0; i < wet.length; i++) wet[i] = Math.min(1, w2[i]);
    }
    const anyWater = wet.some((v) => v > 0.05);
    // 顶点 y:地面 +0.15,水上再抬 0.95 ×(平滑权重)
    const ys = pts.map((_, i) => {
      const th = Math.max(terrainHeight(pts[i][0], pts[i][1]), 0);
      return th + 0.15 + wet[i] * 0.95;
    });
    const setY = (geo, dy = 0) => {
      const p = geo.attributes.position;
      for (let i = 0; i < p.count; i++) p.setY(i, ys[Math.min(ys.length - 1, Math.floor(i / 2))] + dy);
      geo.computeVertexNormals();
      return geo;
    };

    if (anyWater) {
      // 路基堤(比路面宽,沉到水下 1.3 m)
      const bed = new THREE.Mesh(setY(ribbonGeometry(pts, r.w + 6, 0), -1.3), bedMat);
      group.add(bed);
    }
    const mesh = new THREE.Mesh(setY(ribbonGeometry(pts, r.w, 0)), asphaltMatCache());
    mesh.receiveShadow = true;
    group.add(mesh);

    // 中心虚线(主干道;抬高 0.14 m + polygonOffset,远处不再与路面 z-fighting)
    if (r.w >= 24) {
      group.add(new THREE.Mesh(setY(ribbonGeometry(pts, 0.4, 0), 0.14), dashMatCache()));
    }
    centerlines.push({ name: r.name, w: r.w, pts, ys, major: !!r.major });
    if (anyWater) {
      let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
      for (const [x, z] of pts) {
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
      }
      ROAD_DECKS.push({ pts, ys, w: r.w, minX, maxX, minZ, maxZ });
    }
  }
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

/** 水域判定(world 内部用,避免与 ground.js 循环依赖) */
function isWaterXY(x, z) {
  if (distToPolyline(x, z, RIVER_PTS_V) < RIVER.halfWidth) return true;
  for (const b of BRANCH_PTS_V) if (distToPolyline(x, z, b.pts) < b.hw) return true;
  for (const p of LAKE_POLYS_V) if (pointInPolygon(x, z, p)) return true;
  return false;
}
const RIVER_PTS_V = toV2List(RIVER.pts);
const BRANCH_PTS_V = RIVER.branches.map((b) => ({ hw: b.halfWidth, pts: toV2List(b.pts) }));
const LAKE_POLYS_V = LAKES.map((l) => toV2List(l.pts));

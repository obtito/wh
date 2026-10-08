// 通用几何 / 贴图 / 实例化工具(米制尺度,自 GTA-NJ lib.js 移植适配)
import * as THREE from 'three';

/* ---------------- 材质缓存 ---------------- */
const matCache = new Map();
export function mat(hex, opts = {}) {
  const key = hex + '|' + JSON.stringify(opts, (k, v) => (v && v.isTexture ? 'TEX' : v));
  if (matCache.has(key)) return matCache.get(key);
  const m = new THREE.MeshStandardMaterial({
    color: new THREE.Color(hex),
    roughness: opts.rough ?? 0.85,
    metalness: opts.metal ?? 0.05,
    emissive: opts.emissive ? new THREE.Color(opts.emissive) : new THREE.Color(0x000000),
    emissiveIntensity: opts.emissiveIntensity ?? 1,
    emissiveMap: opts.emissiveMap || null,
    transparent: !!opts.transparent,
    opacity: opts.opacity ?? 1,
    side: opts.side ?? THREE.FrontSide,
    map: opts.map || null,
    normalMap: opts.normalMap || null,
    bumpMap: opts.bumpMap || null,
    roughnessMap: opts.roughnessMap || null,
    flatShading: !!opts.flat,
  });
  if (opts.normalScale) m.normalScale.copy(opts.normalScale);
  matCache.set(key, m);
  registerEnv(m, opts.env ?? 0.5);
  return m;
}

/* ---------------- 照片级贴图加载(Poly Haven CC0,assets/textures/) ---------------- */
let _texLoader = null;
export function loadTexture(url, { srgb = true, aniso = 4 } = {}) {
  if (typeof document === 'undefined') return null;
  if (!_texLoader) _texLoader = new THREE.TextureLoader();
  const t = _texLoader.load(url);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = aniso;
  return t;
}

/* ---------------- 程序化贴图 ---------------- */
function canvas(size) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  return c;
}
function toTexture(c, repeat = null) {
  const t = new THREE.CanvasTexture(c);
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.colorSpace = THREE.SRGBColorSpace;
  t.anisotropy = 4;
  if (repeat) t.repeat.set(repeat, repeat);
  return t;
}

/** 建筑立面:8×8 窗格/贴图,配 uvU=28,uvV=24(每窗约 3.5m 宽 × 3m 高,米制) */
export function makeFacadeTexture() {
  if (typeof document === 'undefined') return null;
  const S = 256, c = canvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#e8eaec'; ctx.fillRect(0, 0, S, S);
  const rows = 8, cols = 8, step = S / rows;
  ctx.fillStyle = '#d8dbe0';
  for (let r = 0; r < rows; r++) ctx.fillRect(0, r * step + step - 2, S, 2);
  for (let col = 0; col <= cols; col++) ctx.fillRect(col * step - 1, 0, 2, S);
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const v = Math.random();
      ctx.fillStyle = v > 0.7 ? '#9fb0bd' : v > 0.35 ? '#7f8d99' : '#a5b0b8';
      ctx.fillRect(col * step + 4, r * step + 4, step - 9, step - 9);
    }
  }
  return toTexture(c);
}

/** 夜间窗光遮罩(与立面窗格对齐,同一套 8×8) */
export function makeWindowTexture() {
  if (typeof document === 'undefined') return null;
  const S = 256, c = canvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#000000'; ctx.fillRect(0, 0, S, S);
  const rows = 8, cols = 8, step = S / rows;
  for (let r = 0; r < rows; r++) {
    for (let col = 0; col < cols; col++) {
      const v = Math.random();
      if (v < 0.34) continue;
      const lit = v < 0.72 ? 90 : v < 0.92 ? 180 : 255;
      ctx.fillStyle = `rgb(${lit},${Math.round(lit * 0.93)},${Math.round(lit * 0.78)})`;
      ctx.fillRect(col * step + 4, r * step + 4, step - 9, step - 9);
    }
  }
  return toTexture(c);
}

/** 沥青路面:暗灰 + 骨料颗粒 + 修补斑 */
export function makeAsphaltTexture() {
  if (typeof document === 'undefined') return null;
  const S = 256, c = canvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#3f4145'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 4200; i++) {
    const g = Math.random();
    ctx.fillStyle = g > 0.5 ? `rgba(96,100,106,${0.25 + Math.random() * 0.3})` : `rgba(24,26,30,${0.2 + Math.random() * 0.3})`;
    ctx.fillRect(Math.random() * S, Math.random() * S, 1 + Math.random() * 2, 1 + Math.random() * 2);
  }
  for (let i = 0; i < 8; i++) {  // 修补坑洼
    const x = Math.random() * S, y = Math.random() * S, r = 8 + Math.random() * 26;
    const g = ctx.createRadialGradient(x, y, 0, x, y, r);
    g.addColorStop(0, 'rgba(20,20,24,0.35)');
    g.addColorStop(1, 'rgba(0,0,0,0)');
    ctx.fillStyle = g;
    ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
  }
  return toTexture(c);
}

/** 人行道砖 */
export function makeSidewalkTexture() {
  if (typeof document === 'undefined') return null;
  const S = 256, c = canvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#9a9a94'; ctx.fillRect(0, 0, S, S);
  const n = 8, step = S / n;
  for (let r = 0; r < n; r++) {
    for (let col = 0; col < n; col++) {
      const v = 0.9 + Math.random() * 0.2;
      ctx.fillStyle = `rgb(${(154 * v) | 0},${(154 * v) | 0},${(146 * v) | 0})`;
      ctx.fillRect(col * step + 1.5, r * step + 1.5, step - 3, step - 3);
    }
  }
  return toTexture(c);
}

/** 红砖(里分/民国街屋) */
export function makeBrickTexture() {
  if (typeof document === 'undefined') return null;
  const S = 256, c = canvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#7a4a3a'; ctx.fillRect(0, 0, S, S);
  const rows = 16, cols = 8, bw = S / cols, bh = S / rows;
  for (let r = 0; r < rows; r++) {
    const off = (r % 2 === 0) ? 0 : bw * 0.5;
    for (let k = 0; k < cols; k++) {
      const v = 0.85 + Math.random() * 0.3;
      ctx.fillStyle = `rgb(${(158 * v) | 0},${(84 * v) | 0},${(66 * v) | 0})`;
      ctx.fillRect(k * bw + off + 1.5, r * bh + 1.5, bw - 3, bh - 3);
    }
  }
  return toTexture(c);
}

/** 地面(草地/地块):多尺度斑块 */
export function makeGroundTexture(repeat = 400) {
  if (typeof document === 'undefined') return null;
  const S = 512, c = canvas(S), ctx = c.getContext('2d');
  ctx.fillStyle = '#b9bfa5'; ctx.fillRect(0, 0, S, S);
  for (let i = 0; i < 90; i++) {
    const x = Math.random() * S, y = Math.random() * S;
    const w = 30 + Math.random() * 130, h = 30 + Math.random() * 130;
    const g = Math.random();
    ctx.fillStyle = g > 0.62 ? 'rgba(150,168,124,0.30)'
      : g > 0.32 ? 'rgba(196,196,176,0.26)' : 'rgba(126,146,98,0.26)';
    ctx.beginPath();
    ctx.ellipse(x, y, w * 0.5, h * 0.5, Math.random() * Math.PI, 0, Math.PI * 2);
    ctx.fill();
  }
  for (let i = 0; i < 14000; i++) {
    const g = Math.random();
    ctx.fillStyle = g > 0.5 ? 'rgba(150,168,124,0.55)' : 'rgba(196,196,176,0.5)';
    ctx.fillRect(Math.random() * S, Math.random() * S, 2 + Math.random() * 3, 2 + Math.random() * 3);
  }
  return toTexture(c, repeat);
}

/* ---------------- 几何构建 ---------------- */

/** 强制朝上的四边形集合构造器 */
export class QuadBuilder {
  constructor() { this.pos = []; this.uv = []; this.idx = []; }
  addPoly(p, y = 0, uvScale = 0.1) {
    if (p.length < 3) return this;
    const ux = p[1][0] - p[0][0], uz = p[1][1] - p[0][1];
    const vx = p[2][0] - p[0][0], vz = p[2][1] - p[0][1];
    const ny = uz * vx - ux * vz;
    const pts = ny < 0 ? p.slice().reverse() : p;
    const base = this.pos.length / 3;
    for (let i = 0; i < pts.length; i++) {
      this.pos.push(pts[i][0], y, pts[i][1]);
      this.uv.push(pts[i][0] * uvScale, pts[i][1] * uvScale);
    }
    for (let i = 1; i < pts.length - 1; i++) this.idx.push(base, base + i, base + i + 1);
    return this;
  }
  addRect(cx, cz, w, d, y = 0, rot = 0, uvScale = 0.1) {
    const c = Math.cos(rot), s = Math.sin(rot);
    const hw = w / 2, hd = d / 2;
    const corners = [[-hw, -hd], [hw, -hd], [hw, hd], [-hw, hd]].map(([x, z]) => [
      cx + x * c - z * s, cz + x * s + z * c,
    ]);
    this.addPoly(corners, y, uvScale);
    return this;
  }
  build(flat = true) {
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.Float32BufferAttribute(this.pos, 3));
    g.setAttribute('uv', new THREE.Float32BufferAttribute(this.uv, 2));
    g.setIndex(this.idx);
    if (flat) {
      const n = new Float32Array((this.pos.length / 3) * 3);
      for (let i = 0; i < n.length / 3; i++) n[i * 3 + 1] = 1;
      g.setAttribute('normal', new THREE.BufferAttribute(n, 3));
    } else g.computeVertexNormals();
    return g;
  }
}

/** 沿折线生成带状面(道路/河流),自动朝上;width 可为 (t01)=>number */
export function ribbonGeometry(points, width, y = 0.02, uvScale = 0.05) {
  const n = points.length;
  const pos = [], uv = [], idx = [];
  let acc = 0; const cum = [0];
  for (let i = 1; i < n; i++) {
    acc += Math.hypot(points[i][0] - points[i - 1][0], points[i][1] - points[i - 1][1]);
    cum.push(acc);
  }
  for (let i = 0; i < n; i++) {
    const prev = points[Math.max(0, i - 1)], next = points[Math.min(n - 1, i + 1)];
    const here = points[i];
    let ax = here[0] - prev[0], az = here[1] - prev[1];
    let bx = next[0] - here[0], bz = next[1] - here[1];
    if (i === 0) { ax = bx; az = bz; }
    if (i === n - 1) { bx = ax; bz = az; }
    const al = Math.hypot(ax, az) || 1, bl = Math.hypot(bx, bz) || 1;
    ax /= al; az /= al; bx /= bl; bz /= bl;
    let nx = -az - bz, nz = ax + bx;
    const nl = Math.hypot(nx, nz);
    if (nl < 0.001) { nx = -bz; nz = bx; } else { nx /= nl; nz /= nl; }
    const w = typeof width === 'function' ? width(n > 1 ? i / (n - 1) : 0) : width;
    const miter = Math.min(1.5, 1 / Math.max(0.2, nx * -bz + nz * bx)) * w * 0.5;
    pos.push(here[0] + nx * miter, y, here[1] + nz * miter);
    pos.push(here[0] - nx * miter, y, here[1] - nz * miter);
    const u = cum[i] * uvScale;
    uv.push(u, 0, u, 1);
    if (i < n - 1) {
      const a = i * 2, b = a + 1, c = a + 2, d = a + 3;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute('position', new THREE.Float32BufferAttribute(pos, 3));
  g.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  g.setIndex(idx);
  const nor = new Float32Array((pos.length / 3) * 3);
  for (let i = 0; i < nor.length / 3; i++) nor[i * 3 + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  return g;
}

/** 简单多边形 → XZ 平面水平面片(保证朝上) */
export function polygonGeometry(points, y = 0, holes = []) {
  const shape = new THREE.Shape(points.map((p) => new THREE.Vector2(p[0], p[1])));
  for (const h of holes) shape.holes.push(new THREE.Path(h.map((p) => new THREE.Vector2(p[0], p[1]))));
  const g = new THREE.ShapeGeometry(shape);
  g.rotateX(Math.PI / 2);
  g.translate(0, y, 0);
  const nor = new Float32Array(g.attributes.position.count * 3);
  for (let i = 0; i < nor.length / 3; i++) nor[i * 3 + 1] = 1;
  g.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  const idx = g.index.array;
  if (idx && idx.length >= 3) {
    const p0 = [], p1 = [], p2 = [];
    ['x', 'y', 'z'].forEach((k, j) => {
      p0.push(g.attributes.position.array[idx[0] * 3 + j]);
      p1.push(g.attributes.position.array[idx[1] * 3 + j]);
      p2.push(g.attributes.position.array[idx[2] * 3 + j]);
    });
    const u = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
    const v = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
    const ny = u[2] * v[0] - u[0] * v[2];
    if (ny < 0) {
      const arr = Array.from(idx);
      for (let i = 0; i < arr.length; i += 3) {
        const t = arr[i + 1]; arr[i + 1] = arr[i + 2]; arr[i + 2] = t;
      }
      g.setIndex(arr);
    }
  }
  return g;
}

/* ---------------- 材质 shader 补丁(可叠加,程序缓存键自动维护) ---------------- */
export function patchMaterial(material, name, fn) {
  const list = material.userData.__patches || (material.userData.__patches = []);
  if (list.some((p) => p.name === name)) return material;
  list.push({ name, fn });
  material.onBeforeCompile = (shader, renderer) => {
    for (const p of list) p.fn(shader, renderer);
  };
  material.customProgramCacheKey = () => list.map((p) => p.name).join('|');
  return material;
}

/* ---------------- 环境反射强度登记表 ---------------- */
const ENV_MATS = [];
export function registerEnv(material, base = 0.5) {
  if (!material || material.userData.envRegistered) return material;
  material.userData.envRegistered = true;
  material.userData.envBase = base;
  material.envMapIntensity = base;
  ENV_MATS.push(material);
  return material;
}
let lastEnvK = -1;
export function setEnvIntensity(k) {
  if (Math.abs(k - lastEnvK) < 0.004) return;
  lastEnvK = k;
  for (const m of ENV_MATS) m.envMapIntensity = (m.userData.envBase ?? 1) * k;
}

/* ---------------- 单位几何体(以原点为底) ---------------- */
export const UNIT = {
  box: new THREE.BoxGeometry(1, 1, 1).translate(0, 0.5, 0),
  cyl: new THREE.CylinderGeometry(0.5, 0.5, 1, 16).translate(0, 0.5, 0),
  cyl8: new THREE.CylinderGeometry(0.5, 0.5, 1, 8).translate(0, 0.5, 0),
  cone: new THREE.ConeGeometry(0.5, 1, 12).translate(0, 0.5, 0),
  cone4: new THREE.ConeGeometry(0.5, 1, 4).translate(0, 0.5, 0),
  sphere: new THREE.SphereGeometry(0.5, 16, 12),
  plane: new THREE.PlaneGeometry(1, 1).rotateX(-Math.PI / 2),
};

/** 实例化方块群:items [{x,z,y,w,h,d,rot,tint,shade,r2,r3}] */
export function instancedBoxes(items, material, opts = {}) {
  const n = items.length;
  if (!n) return null;
  const geo = UNIT.box.clone();
  const uvArr = new Float32Array(n * 4);
  const mesh = new THREE.InstancedMesh(geo, material, n);
  mesh.castShadow = opts.cast !== false;
  mesh.receiveShadow = opts.receive !== false;
  mesh.frustumCulled = false;
  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  for (let i = 0; i < n; i++) {
    const b = items[i];
    dummy.position.set(b.x, b.y || 0, b.z);
    dummy.rotation.set(b.rotX || 0, b.rot || 0, b.rotZ || 0);
    dummy.scale.set(b.w, b.h, b.d);
    dummy.updateMatrix();
    mesh.setMatrixAt(i, dummy.matrix);
    if (b.tint) {
      col.set(b.tint);
      if (b.shade !== undefined) col.multiplyScalar(b.shade);
      mesh.setColorAt(i, col);
    }
    uvArr[i * 4] = b.r2 ?? 0.5;
    uvArr[i * 4 + 1] = b.r3 ?? 0.5;
    uvArr[i * 4 + 2] = Math.max(1, Math.round(b.w / (opts.uvU || 28)));
    uvArr[i * 4 + 3] = Math.max(1, Math.round(b.h / (opts.uvV || 24)));
  }
  geo.setAttribute('aUv', new THREE.InstancedBufferAttribute(uvArr, 4));
  mesh.instanceMatrix.needsUpdate = true;
  if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  return mesh;
}

/** 合批:把子树中「静态且同材质」的 mesh 合并成少量大 mesh(返回收益统计) */
export function mergeStaticMeshes(root, exclude = null) {
  const skip = new Set();
  if (exclude && exclude.size) {
    for (const e of exclude) { const s = [e]; while (s.length) { const n = s.pop(); skip.add(n); (n.children || []).forEach((c) => s.push(c)); } }
  }
  root.updateWorldMatrix(true, true);
  const inv = new THREE.Matrix4().copy(root.matrixWorld).invert();
  const tmpM = new THREE.Matrix4();
  const buckets = new Map();
  const doomed = [];
  let before = 0;
  const im = new THREE.Matrix4();
  const collect = (o) => {
    for (const c of o.children.slice()) {
      if (skip.has(c)) continue;
      if (c.isMesh) {
        if (c.userData && c.userData.noMerge) continue;
        if (!c.geometry || !c.geometry.attributes.position) continue;
        if (Array.isArray(c.material)) continue;
        before++;
        const key = c.material.uuid;
        let b = buckets.get(key);
        if (!b) buckets.set(key, (b = { material: c.material, list: [], cast: false, receive: false }));
        if (c.isInstancedMesh) {
          const base = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
          for (let ii = 0; ii < c.count; ii++) {
            c.getMatrixAt(ii, im);
            const world = new THREE.Matrix4().multiplyMatrices(c.matrixWorld, im);
            const g2 = base.clone();
            if (!g2.attributes.normal) g2.computeVertexNormals();
            if (!g2.attributes.uv) {
              const n = g2.attributes.position.count;
              g2.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
            }
            g2.applyMatrix4(tmpM.multiplyMatrices(inv, world));
            if (c.instanceColor) {
              const tint = new THREE.Color(); c.getColorAt(ii, tint);
              const colors = new Float32Array(g2.attributes.position.count * 3);
              for (let v = 0; v < colors.length; v += 3) {
                const attr = g2.attributes.color, k = v / 3;
                colors[v] = tint.r * (attr ? attr.getX(k) : 1);
                colors[v + 1] = tint.g * (attr ? attr.getY(k) : 1);
                colors[v + 2] = tint.b * (attr ? attr.getZ(k) : 1);
              }
              g2.setAttribute('color', new THREE.BufferAttribute(colors, 3));
            }
            b.list.push(g2);
          }
          base.dispose();
        } else {
          let geo = c.geometry.index ? c.geometry.toNonIndexed() : c.geometry.clone();
          if (!geo.attributes.normal) geo.computeVertexNormals();
          if (!geo.attributes.uv) {
            const n = geo.attributes.position.count;
            geo.setAttribute('uv', new THREE.BufferAttribute(new Float32Array(n * 2), 2));
          }
          geo.applyMatrix4(tmpM.multiplyMatrices(inv, c.matrixWorld));
          b.list.push(geo);
        }
        b.cast = b.cast || !!c.castShadow;
        b.receive = b.receive || !!c.receiveShadow;
        doomed.push([c, o]);
      } else if (c.children && c.children.length) collect(c);
    }
  };
  collect(root);
  let after = 0, tris = 0;
  for (const b of buckets.values()) {
    if (!b.list.length) continue;
    const geo = concatGeometries(b.list);
    for (const g of b.list) g.dispose();
    let material = b.material;
    if (geo.attributes.color && !material.vertexColors) {
      material = material.clone(); material.vertexColors = true;
      // Clones keep night-glow and environment behaviour after batching.
      delete material.userData.envRegistered;
      registerEnv(material, b.material.userData.envBase ?? .5);
    }
    const m = new THREE.Mesh(geo, material);
    m.name = 'merged';
    m.castShadow = b.cast;
    m.receiveShadow = b.receive;
    m.matrixAutoUpdate = false;
    m.updateMatrix();
    root.add(m);
    after++;
    tris += (geo.attributes.position ? geo.attributes.position.count : 0) / 3;
  }
  for (const [mesh, parent] of doomed) parent.remove(mesh);
  return { before, after, tris: Math.round(tris) };
}

function concatGeometries(list) {
  let total = 0;
  for (const g of list) total += g.attributes.position.count;
  const pos = new Float32Array(total * 3);
  const nor = new Float32Array(total * 3);
  const uv = new Float32Array(total * 2);
  const color = list.some(g => g.attributes.color) ? new Float32Array(total * 3) : null;
  let vo = 0;
  for (const g of list) {
    const p = g.attributes.position, n = g.attributes.normal, t = g.attributes.uv;
    const c = p.count;
    for (let i = 0; i < c; i++) {
      const o3 = (vo + i) * 3, o2 = (vo + i) * 2;
      pos[o3] = p.getX(i); pos[o3 + 1] = p.getY(i); pos[o3 + 2] = p.getZ(i);
      nor[o3] = n.getX(i); nor[o3 + 1] = n.getY(i); nor[o3 + 2] = n.getZ(i);
      uv[o2] = t.getX(i); uv[o2 + 1] = t.getY(i);
      if (color) {
        const col = g.attributes.color;
        color[o3] = col ? col.getX(i) : 1;
        color[o3 + 1] = col ? col.getY(i) : 1;
        color[o3 + 2] = col ? col.getZ(i) : 1;
      }
    }
    vo += c;
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.BufferAttribute(pos, 3));
  geo.setAttribute('normal', new THREE.BufferAttribute(nor, 3));
  geo.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  if (color) geo.setAttribute('color', new THREE.BufferAttribute(color, 3));
  geo.computeBoundingSphere();
  return geo;
}

/** 快速放置一个 mesh(单位几何 + scale + 旋转) */
export function put(parent, geo, material, { pos = [0, 0, 0], scale = [1, 1, 1], rot = 0, rotX = 0, rotZ = 0 }) {
  const m = new THREE.Mesh(geo, material);
  m.position.set(pos[0], pos[1], pos[2]);
  m.scale.set(scale[0], scale[1], scale[2]);
  m.rotation.set(rotX, rot, rotZ);
  parent.add(m);
  return m;
}

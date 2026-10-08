// 程序化城市:三镇分区建筑 / 行道树 / 樱花 / 车流(米制)
// 分区数据来自 data.js DISTRICTS(poly 四边形 + gridRot + 风格)
import * as THREE from 'three';
import { toV2, toV2List, makeRandom, clamp, pointInPolygon, distToPolyline } from './geo.js';
import { DISTRICTS, RIVER, LAKES, ROADS } from './data.js';
import { mat, loadTexture, makeFacadeTexture, makeWindowTexture, makeBrickTexture, patchMaterial, instancedBoxes, registerEnv } from './lib.js';
import { loadMergedGLB, loadGLB } from './assets.js';
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js';
import { terrainHeight } from './world.js';

const RIVER_PTS = toV2List(RIVER.pts);
const BRANCH_PTS = RIVER.branches.map((b) => ({ hw: b.halfWidth, pts: toV2List(b.pts) }));
const LAKE_POLYS = LAKES.map((l) => toV2List(l.pts));
const ROAD_LINES = ROADS.map((r) => ({ w: r.w, pts: toV2List(r.pts) }));

/* ============ 掩膜:水/山/路/地标占地之上不生成建筑 ============
 * rad = 楼体外接半径。旧版只判楼心,导致 40~60 m 进深的高层体块
 * 横插进路面("路穿楼");现在把体块半径计入避让。 */
function blocked(x, z, exclusions, osmBox, rad = 0, corridors = null) {
  if (osmBox && x >= osmBox.minX && x <= osmBox.maxX && z >= osmBox.minZ && z <= osmBox.maxZ) return true;
  if (distToPolyline(x, z, RIVER_PTS) < RIVER.halfWidth * 1.35 + rad) return true;
  for (const b of BRANCH_PTS) if (distToPolyline(x, z, b.pts) < b.hw + 20 + rad) return true;
  for (const p of LAKE_POLYS) if (pointInPolygon(x, z, p)) return true;
  if (terrainHeight(x, z) > 2.5) return true;                 // 山坡留绿
  for (const l of ROAD_LINES) {
    if (distToPolyline(x, z, l.pts) < l.w / 2 + 4 + rad) return true;
  }
  if (corridors) {
    for (const l of corridors) {
      if (distToPolyline(x, z, l.pts) < l.w / 2 + 2 + rad) return true;
    }
  }
  for (const e of exclusions) {
    const dx = x - e.x, dz = z - e.z, rr = e.r + rad;
    if (dx * dx + dz * dz < rr * rr) return true;
  }
  return false;
}

/* ============ 风格材质表 ============ */
const STYLES = {
  lifen:      { side: '#c98868', roof: '#7a5040', rough: 0.95, metal: 0.02, emissive: 0.55, env: 0.4, brick: true },   // 汉口里分红砖
  republican: { side: '#d9cbb2', roof: '#6f6a5e', rough: 0.9,  metal: 0.03, emissive: 0.7,  env: 0.5 },                // 江汉路民国
  skyline:    { side: '#c3d3de', roof: '#48505c', rough: 0.25, metal: 0.5,  emissive: 1.25, env: 1.2 },                // 二七滨江玻璃
  modern:     { side: '#cfd4cf', roof: '#565c62', rough: 0.55, metal: 0.25, emissive: 0.95, env: 0.8 },                // 建设大道/中南/徐东
  oldtown:    { side: '#cfc8b8', roof: '#8a5a42', rough: 0.95, metal: 0.0,  emissive: 0.6,  env: 0.45 },               // 汉阳老城
  wuchang:    { side: '#d8cec0', roof: '#3d4436', rough: 0.95, metal: 0.0,  emissive: 0.6,  env: 0.45, pitch: 0.75 },  // 武昌老城坡顶
  glass:      { side: '#a8c4c8', roof: '#3e4a50', rough: 0.2,  metal: 0.55, emissive: 1.3,  env: 1.25 },               // 光谷
  campus:     { side: '#ddd8ca', roof: '#77806b', rough: 0.9,  metal: 0.02, emissive: 0.9,  env: 0.6 },                // 街道口高校
  whu:        { side: '#d3c9b4', roof: '#2f4a3a', rough: 0.92, metal: 0.02, emissive: 0.8,  env: 0.55, pitch: 0.85 },  // 武大绿瓦
  redsteel:   { side: '#b5705c', roof: '#5e5850', rough: 0.95, metal: 0.03, emissive: 0.55, env: 0.4, brick: true },   // 青山红钢城
};
const STYLE_CELL = { lifen: 46, republican: 52, skyline: 105, modern: 82, oldtown: 50, wuchang: 52, glass: 92, campus: 72, whu: 58, redsteel: 74 };

/** 逐实例 UV 重映射:同一张贴图按楼体宽高取不同区域;
 *  法线/粗糙度/凹凸贴图按额外倍率加密(照片纹理的物理尺寸 ≠ 窗格尺寸) */
function patchUV(m, texK = 1) {
  patchMaterial(m, 'aUv', (shader) => {
    shader.vertexShader = 'attribute vec4 aUv;\n' + shader.vertexShader.replace(
      '#include <uv_vertex>',
      `#include <uv_vertex>
      #ifdef USE_MAP
        vMapUv = vMapUv * aUv.zw + aUv.xy;
      #endif
      #ifdef USE_EMISSIVEMAP
        vEmissiveMapUv = vEmissiveMapUv * aUv.zw + aUv.xy;
      #endif
      #ifdef USE_NORMALMAP
        vNormalMapUv = vNormalMapUv * aUv.zw * ${texK.toFixed(2)} + aUv.xy;
      #endif
      #ifdef USE_ROUGHNESSMAP
        vRoughnessMapUv = vRoughnessMapUv * aUv.zw * ${texK.toFixed(2)} + aUv.xy;
      #endif
      #ifdef USE_BUMPMAP
        vBumpMapUv = vBumpMapUv * aUv.zw + aUv.xy;
      #endif`
    );
  });
  return m;
}

/* ============ 建筑 ============ */
export function buildCity({ exclusions = [], seed = 20261001, osmBox = null, corridors = null } = {}) {
  const rand = makeRandom(seed);
  const facade = makeFacadeTexture();
  const windowsTex = makeWindowTexture();
  const brickTex = makeBrickTexture();

  // 照片级 CC0 贴图(Poly Haven / three.js 示例,见 docs/ATTRIBUTION.md)
  const brickDiff = loadTexture('./assets/textures/brick_diffuse.jpg');
  const brickBump = loadTexture('./assets/textures/brick_bump.jpg', { srgb: false });
  const concDiff = loadTexture('./assets/textures/rough_concrete_diff_2k.jpg');
  const concNor = loadTexture('./assets/textures/rough_concrete_nor_gl_2k.jpg', { srgb: false });
  const concRough = loadTexture('./assets/textures/rough_concrete_rough_2k.jpg', { srgb: false });

  const group = new THREE.Group();
  group.name = 'city';

  const buckets = {};
  const details = { cap: [], antenna: [], pitch: [], parapet: [], tank: [], ac: [], shop: [], crown: [] };
  const mats = { wall: [], roof: [], misc: [] };
  let shopMatRef = null;
  const boxes = [];        // 碰撞 OBB(cx,cz,hx,hz,cos,sin,topY)stride 7

  /** 局部坐标(相对建筑中心,含旋转)→ 世界坐标 */
  const local = (x, z, lx, lz, rot) => {
    const c = Math.cos(rot), s = Math.sin(rot);
    return [x + lx * c - lz * s, z + lx * s + lz * c];
  };

  for (const d of DISTRICTS) {
    const style = STYLES[d.style] || STYLES.modern;
    const bucket = (buckets[d.style] = buckets[d.style] || { items: [], podium: [], setback: [] });
    const poly = toV2List(d.poly);
    const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
    const cz = poly.reduce((a, p) => a + p[1], 0) / poly.length;
    const rot = (d.gridRot * Math.PI) / 180;
    // 旋转框内的半宽
    const c = Math.cos(rot), s = Math.sin(rot);
    let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const [x, z] of poly) {
      const lx = (x - cx) * c + (z - cz) * s;
      const lz = -(x - cx) * s + (z - cz) * c;
      minX = Math.min(minX, lx); maxX = Math.max(maxX, lx);
      minZ = Math.min(minZ, lz); maxZ = Math.max(maxZ, lz);
    }
    const W = maxX - minX, D = maxZ - minZ;
    const cell = STYLE_CELL[d.style] || 70;
    const nx = Math.max(1, Math.round(W / cell)), nz = Math.max(1, Math.round(D / cell));
    const toWorld = (lx, lz) => [cx + lx * c - lz * s, cz + lx * s + lz * c];
    const maxR = Math.hypot(W, D) / 2;
    const density = { skyline: 0.5, glass: 0.55, lifen: 0.85, whu: 0.5 }[d.style] || 0.68;

    for (let i = 0; i < nx; i++) {
      for (let j = 0; j < nz; j++) {
        if (rand() > density) continue;
        // 抖动压缩到 ±0.05 cell:相邻楼心最小间距 0.9 cell
        const lx = minX + (i + 0.5) * cell + (rand() - 0.5) * cell * 0.1;
        const lz = minZ + (j + 0.5) * cell + (rand() - 0.5) * cell * 0.1;
        // 四边形内才生成(区外切掉)
        const [wx, wz] = toWorld(lx, lz);
        if (!pointInPolygon(wx, wz, poly)) continue;

        const r = Math.hypot(lx, lz) / maxR;
        const core = Math.pow(clamp(1 - r * 0.9, 0, 1), d.style === 'skyline' || d.style === 'glass' ? 1.3 : 2.2);
        const tall = Math.pow(rand(), d.style === 'skyline' ? 1.6 : 2.4);
        let hMeters = d.hMin + (d.hMax - d.hMin) * (0.25 + 0.75 * tall) * (0.55 + 0.45 * core);
        const ground = Math.max(terrainHeight(wx, wz), 0);
        const h = Math.max(4, hMeters);

        // 进深上限 0.76 cell:两楼最大半跨和 0.806 cell < 0.9 cell 间距 → 结构上不可能"楼穿楼"
        const fw = cell * (0.46 + rand() * 0.30);
        const fd = cell * (0.46 + rand() * 0.30);
        const yRot = rot + (rand() - 0.5) * 0.12;
        // 网格朝向 = three 的 Ry(-rot);楼体 rotation.y 取 -yRot 才能与街区走向、
        // 细节件偏移(local() 用 Ry(-rot) 口径)三者一致 —— 旧版差一个符号,
        // 导致女儿墙/水箱/空调外机整体绕楼心转了 2·gridRot,悬在楼体之外。
        const mRot = -yRot;
        // 体块外接半径(计入避让,防"路穿楼")
        const rad = 0.5 * Math.hypot(fw, fd);
        if (blocked(wx, wz, exclusions, osmBox, rad, corridors)) continue;
        const x = wx, z = wz;

        /* 体量分层(podium / setback) */
        let hShaft = h;
        if (hMeters > 85 && rand() > 0.3) {
          const ph = Math.min(h * 0.3, 14 + rand() * 16);
          const pw = Math.min(fw * (1.2 + rand() * 0.2), cell * 0.86);
          const pd = Math.min(fd * (1.2 + rand() * 0.2), cell * 0.86);
          bucket.podium.push({ x, z, y: ground, w: pw, h: ph, d: pd, rot: mRot, r2: rand(), r3: rand() });
        }
        if (hMeters > 150 && rand() > 0.35) {
          const sh = h * (0.15 + rand() * 0.22);
          hShaft = h - sh;
          bucket.setback.push({
            x, z, y: ground + hShaft, h: sh,
            w: fw * (0.6 + rand() * 0.22), d: fd * (0.6 + rand() * 0.22),
            rot: mRot, r2: rand(), r3: rand(),
          });
        }

        bucket.items.push({
          x, z, y: ground, w: fw, h: hShaft, d: fd, rot: mRot,
          r2: rand(), r3: rand(), shade: 0.86 + rand() * 0.28,
        });
        // 碰撞 OBB(内缩 0.4 m)
        boxes.push(
          x, z, Math.max(0.6, fw / 2 - 0.4), Math.max(0.6, fd / 2 - 0.4),
          Math.cos(mRot), Math.sin(mRot), ground + hShaft,
        );

        // 坡屋顶(武昌老城/武大/汉阳/里分的小房子)
        if (style.pitch && fw < 26 && rand() < style.pitch) {
          const pw = Math.min(fw * 1.12, cell * 0.9);
          details.pitch.push({ x, z, y: ground + hShaft, w: pw, h: 2.5 + rand() * 3.5, d: pw, rot: mRot });
        }
        if (h > 30 && rand() > 0.45) {
          details.cap.push({ x, z, y: ground + hShaft, w: fw * (0.3 + rand() * 0.3), h: 2 + rand() * 3, d: fd * 0.5, rot: mRot });
        }
        if (hMeters > 90 && rand() > 0.5) {
          details.antenna.push({ x, z, y: ground + hShaft, h: 6 + rand() * 18 });
        }

        /* ---- 立面与屋顶细节件(治"方块感":女儿墙/水箱/空调外机/商铺基座/楼冠) ---- */
        const hTop = ground + hShaft;
        // 女儿墙:顶面四边矮墙
        if (hShaft > 15) {
          const pw = 0.9;
          for (const [ex, ez, rw, rd] of [
            [0, -(fd / 2 - 0.2), fw, 0.4], [0, fd / 2 - 0.2, fw, 0.4],
            [-(fw / 2 - 0.2), 0, 0.4, fd], [fw / 2 - 0.2, 0, 0.4, fd],
          ]) {
            const [px, pz] = local(x, z, ex, ez, yRot);
            details.parapet.push({ x: px, z: pz, y: hTop, w: rw, h: pw, d: rd, rot: mRot, tint: '#ffffff', shade: 0.92 });
          }
        }
        // 屋顶水箱/电梯机房
        if (rand() < 0.62) {
          const [tx, tz] = local(x, z, (rand() - 0.5) * fw * 0.4, (rand() - 0.5) * fd * 0.4, yRot);
          const tw = Math.min(fw, fd) * (0.2 + rand() * 0.14);
          details.tank.push({ x: tx, z: tz, y: hTop, w: tw, h: 2.0 + rand() * 1.8, d: tw * 0.85, rot: mRot + (rand() - 0.5) * 0.3 });
        }
        // 空调外机:立面悬挂(低层建筑为主)
        if (hShaft < 60 && fw > 8) {
          const n = 2 + Math.floor(rand() * 4);
          for (let k = 0; k < n; k++) {
            const side = Math.floor(rand() * 4);
            const hy = ground + 3 + rand() * (hShaft - 5);
            const lx = side < 2 ? 0 : (side === 2 ? fw / 2 + 0.3 : -fw / 2 - 0.3);
            const lz = side === 0 ? fd / 2 + 0.3 : side === 1 ? -fd / 2 - 0.3 : (rand() - 0.5) * fd * 0.7;
            const lxx = side < 2 ? (rand() - 0.5) * fw * 0.7 : lx;
            const [ax, az] = local(x, z, lxx, lz, yRot);
            details.ac.push({ x: ax, z: az, y: hy, w: 1.15, h: 0.8, d: 0.5, rot: mRot + (side >= 2 ? Math.PI / 2 : 0) });
          }
        }
        // 商铺基座:临街底层深色 storefront 带
        if (hShaft > 18) {
          const sh = Math.min(4.4, hShaft * 0.24);
          details.shop.push({ x, z, y: ground, w: fw + 0.3, h: sh, d: fd + 0.3, rot: mRot, tint: '#3a3f46', shade: 1 });
        }
        // 楼冠:高层顶部收分冠部
        if (hMeters > 60 && rand() < 0.35) {
          details.crown.push({ x, z, y: hTop, w: fw * 0.72, h: 2.6 + rand() * 3.2, d: fd * 0.72, rot: mRot });
        }
      }
    }
  }

  /* 构建 InstancedMesh(每种风格一套六面材质) */
  const meshes = [];
  const allBuckets = [];
  for (const [styleKey, bucket] of Object.entries(buckets)) {
    if (!bucket.items.length) continue;
    const st = STYLES[styleKey];
    // 贴图策略:砖构风格用照片砖纹(diffuse+bump);其余用程序窗格 + 照片混凝土法线/粗糙度
    let map, extra = {};
    if (st.brick && brickDiff) {
      map = brickDiff;
      extra = brickBump ? { bumpMap: brickBump, bumpScale: 0.35 } : {};
    } else {
      map = facade;
      if (concNor) extra = { normalMap: concNor, ...(concRough ? { roughnessMap: concRough } : {}), normalScale: new THREE.Vector2(0.55, 0.55) };
    }
    const sideMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(st.side),
      map, emissiveMap: windowsTex,
      emissive: new THREE.Color('#ffc98a'),
      emissiveIntensity: 0,
      roughness: st.rough, metalness: st.metal,
      ...extra,
    });
    patchUV(sideMat, st.brick ? 1 : 3.5);
    registerEnv(sideMat, st.env);
    const roofMat = new THREE.MeshStandardMaterial({
      color: new THREE.Color(st.roof), roughness: 0.95, metalness: 0.05,
      ...(concNor && !st.brick ? { normalMap: concNor, normalScale: new THREE.Vector2(0.3, 0.3) } : {}),
    });
    patchUV(roofMat, 3.5);
    registerEnv(roofMat, st.env * 0.55);
    const darkMat = new THREE.MeshStandardMaterial({ color: new THREE.Color('#5a5f63'), roughness: 1 });
    registerEnv(darkMat, st.env * 0.5);
    const materials = [sideMat, sideMat, roofMat, darkMat, sideMat, sideMat];
    mats.wall.push(sideMat); mats.roof.push(roofMat); mats.misc.push(darkMat);

    const uvOpts = { uvU: st.brick ? 2.6 : 28, uvV: st.brick ? 2.6 : 24 };
    const mesh = instancedBoxes(bucket.items, materials, uvOpts);
    mesh.name = 'buildings:' + styleKey;
    group.add(mesh);
    bucket.sideMat = sideMat;
    bucket.styleKey = styleKey;
    allBuckets.push(bucket);
    meshes.push(mesh);

    if (bucket.podium.length) {
      const m = instancedBoxes(bucket.podium, materials, uvOpts);
      m.name = 'podium:' + styleKey;
      group.add(m); meshes.push(m);
    }
    if (bucket.setback.length) {
      const m = instancedBoxes(bucket.setback, materials, uvOpts);
      m.name = 'setback:' + styleKey;
      group.add(m); meshes.push(m);
    }
  }

  // 坡屋顶(四棱锥,深灰/绿)
  if (details.pitch.length) {
    const pitchMat = new THREE.MeshStandardMaterial({ color: 0x3e463c, roughness: 0.95, flatShading: true });
    registerEnv(pitchMat, 0.4);
    const geo = new THREE.ConeGeometry(Math.SQRT1_2, 1, 4).rotateY(Math.PI / 4).translate(0, 0.5, 0);   // 底面 1×1 的方锥
    const m = new THREE.InstancedMesh(geo, pitchMat, details.pitch.length);
    m.frustumCulled = false;
    const dummy = new THREE.Object3D();
    details.pitch.forEach((p, i) => {
      dummy.position.set(p.x, p.y, p.z);
      dummy.rotation.set(0, p.rot, 0);
      dummy.scale.set(p.w, p.h, p.d);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    m.castShadow = true;
    group.add(m); meshes.push(m);
    mats.misc.push(pitchMat);
  }
  // 屋顶设备
  if (details.cap.length) {
    const capMat = new THREE.MeshStandardMaterial({ color: 0x8d9095, roughness: 0.9 });
    registerEnv(capMat, 0.6);
    const m = instancedBoxes(details.cap, capMat);
    m.name = 'rooftopCaps';
    group.add(m); meshes.push(m);
    mats.misc.push(capMat);
  }
  // 女儿墙(浅色混凝土,同楼体色系)
  if (details.parapet.length) {
    const pm = new THREE.MeshStandardMaterial({ color: 0xb8bcc0, roughness: 0.9 });
    registerEnv(pm, 0.5);
    const m = instancedBoxes(details.parapet, pm, { uvU: 8, uvV: 1 });
    m.name = 'parapets';
    group.add(m); meshes.push(m);
    mats.misc.push(pm);
  }
  // 屋顶水箱/机房(银灰金属)
  if (details.tank.length) {
    const tm = new THREE.MeshStandardMaterial({ color: 0x9aa2a8, roughness: 0.55, metalness: 0.45 });
    registerEnv(tm, 0.8);
    const m = instancedBoxes(details.tank, tm, { uvU: 4, uvV: 3 });
    m.name = 'tanks';
    group.add(m); meshes.push(m);
    mats.misc.push(tm);
  }
  // 空调外机(米白塑料壳)
  if (details.ac.length) {
    const am = new THREE.MeshStandardMaterial({ color: 0xd8d5cc, roughness: 0.65 });
    registerEnv(am, 0.5);
    const m = instancedBoxes(details.ac, am, { uvU: 1.2, uvV: 0.8 });
    m.name = 'acUnits';
    m.castShadow = false;
    group.add(m); meshes.push(m);
    mats.misc.push(am);
  }
  // 商铺基座(深色 storefront,夜间亮一条)
  if (details.shop.length) {
    const sm = new THREE.MeshStandardMaterial({
      color: 0x2e3238, roughness: 0.6,
      emissive: new THREE.Color('#ffb85e'), emissiveIntensity: 0,
    });
    sm.userData.shopGlow = true;
    registerEnv(sm, 0.7);
    const m = instancedBoxes(details.shop, sm, { uvU: 12, uvV: 4 });
    m.name = 'shopBases';
    group.add(m); meshes.push(m);
    mats.misc.push(sm);
    shopMatRef = sm;
  }
  // 楼冠
  if (details.crown.length) {
    const cm = new THREE.MeshStandardMaterial({ color: 0xa9b0b6, roughness: 0.5, metalness: 0.35 });
    registerEnv(cm, 0.9);
    const m = instancedBoxes(details.crown, cm, { uvU: 10, uvV: 4 });
    m.name = 'crowns';
    group.add(m); meshes.push(m);
    mats.misc.push(cm);
  }
  // 天线
  if (details.antenna.length) {
    const antMat = new THREE.MeshStandardMaterial({ color: 0x7b8288, roughness: 0.6, metalness: 0.4 });
    registerEnv(antMat, 0.9);
    const geo = new THREE.CylinderGeometry(0.12, 0.18, 1, 6).translate(0, 0.5, 0);
    const m = new THREE.InstancedMesh(geo, antMat, details.antenna.length);
    m.frustumCulled = false;
    const dummy = new THREE.Object3D();
    details.antenna.forEach((a, i) => {
      dummy.position.set(a.x, a.y, a.z);
      dummy.scale.set(1, a.h, 1);
      dummy.updateMatrix();
      m.setMatrixAt(i, dummy.matrix);
    });
    m.instanceMatrix.needsUpdate = true;
    group.add(m); meshes.push(m);
    mats.misc.push(antMat);
  }

  /* 夜间灯光 */
  function setNight(k) {
    for (const b of allBuckets) b.sideMat.emissiveIntensity = k * (STYLES[b.styleKey]?.emissive ?? 0.7);
    if (shopMatRef) shopMatRef.emissiveIntensity = k * 1.8;   // 底层商铺灯带
  }

  return {
    group, meshes, mats, setNight,
    count: allBuckets.reduce((s, b) => s + b.items.length, 0),
    boxes: new Float32Array(boxes),        // 碰撞 OBB(stride 7),供运行时装配
  };
}

/* ============ 行道树 / 樱花 / 湖畔绿带 ============ */
/**
 * @param lines    道路中心线(默认手绘主干网;OSM 载入后应传真实中心线,
 *                 否则树会种在已隐藏的手绘路两侧、与真实路网错位)
 * @param blocked  额外占位判定(建筑占地网格),治"树穿楼"
 */
export async function buildTrees({ exclusions = [], seed = 4242, lines = null, blocked = null } = {}) {
  const rand = makeRandom(seed);
  const group = new THREE.Group();
  group.name = 'trees';
  const items = [];          // {x,z,y,s,t,c,sakura}

  const nearBlocked = (x, z) => {
    for (const e of exclusions) {
      const dx = x - e.x, dz = z - e.z;
      if (dx * dx + dz * dz < e.r * e.r) return true;
    }
    // 建筑占地:树冠半径可达 5 m,留出 1.5 m 净距
    if (blocked && blocked(x, z)) return true;
    return false;
  };

  // 1) 行道树:主干道两侧,22 m 一棵(贴真实路面标高,岸线段不会埋进堤里)
  for (const l of (lines || ROAD_LINES)) {
    if (l.w < 16) continue;
    const pts = l.pts;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const d = Math.hypot(bx - ax, bz - az);
      const n = Math.floor(d / 22);
      if (n < 1) continue;
      const dx = (bx - ax) / d, dz = (bz - az) / d;
      const ya = l.ys ? l.ys[i - 1] : Math.max(terrainHeight(ax, az), 0);
      const yb = l.ys ? l.ys[i] : Math.max(terrainHeight(bx, bz), 0);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        for (const side of [-1, 1]) {
          if (rand() < 0.25) continue;                  // 疏密有致
          const off = (l.w / 2 + 3.5) * side;
          const x = ax + (bx - ax) * t - dz * off;
          const z = az + (bz - az) * t + dx * off;
          if (nearBlocked(x, z)) continue;
          items.push({ x, z, y: ya + (yb - ya) * t, s: 0.8 + rand() * 0.5, t: rand(), c: rand(), sakura: false });
        }
      }
    }
  }

  // 2) 武大樱花(珞珈山周边一环,粉白)
  {
    const [cx, cz] = toV2(114.3660, 30.5360);
    for (let i = 0; i < 260; i++) {
      const a = rand() * Math.PI * 2;
      const rr = 300 + Math.sqrt(rand()) * 650;
      const x = cx + Math.cos(a) * rr, z = cz + Math.sin(a) * rr * 0.8;
      if (nearBlocked(x, z)) continue;
      if (terrainHeight(x, z) > 90) continue;
      items.push({ x, z, y: terrainHeight(x, z), s: 0.7 + rand() * 0.4, t: rand(), c: rand(), sakura: true });
    }
  }

  // 3) 东湖绿带(湖岸内侧撒树)
  for (const lake of LAKE_POLYS) {
    for (const [px, pz] of lake) {
      for (let k = 0; k < 26; k++) {
        const a = rand() * Math.PI * 2, rr = 30 + rand() * 130;
        const x = px + Math.cos(a) * rr, z = pz + Math.sin(a) * rr;
        if (pointInPolygon(x, z, lake)) continue;         // 不落水
        if (nearBlocked(x, z)) continue;
        items.push({ x, z, y: terrainHeight(x, z), s: 0.9 + rand() * 0.6, t: rand(), c: rand(), sakura: false });
      }
    }
  }

  /* ---- 几何升级:Kenney Nature Kit(CC0)真树 GLB 实例化 ----
   * 布点逻辑(items)不变;常规树换真模型,樱花保留程序化粉冠(团状花云)。
   * 每型一次 InstancedMesh,整城 6 个 draw call。 */
  const TREE_FILES = [
    './assets/trees/tree_default.glb',
    './assets/trees/tree_default_dark.glb',
    './assets/trees/tree_fat.glb',
    './assets/trees/tree_oak.glb',
    './assets/trees/tree_thin.glb',
    './assets/trees/tree_small.glb',
  ];
  const types = [];                     // { geo, mat, norm(归一到7m基准) }
  for (const f of TREE_FILES) {
    try {
      const root = await loadGLB(f);
      if (!root) continue;
      const meshes = [];
      root.traverse((o) => { if (o.isMesh) meshes.push(o); });
      if (!meshes.length) continue;
      let geo, mtl;
      if (meshes.length === 1) {
        geo = meshes[0].geometry;
        mtl = meshes[0].material;
      } else {
        // 多部件(干/冠分离)合并为一;应用首个非单位变换
        geo = mergeGeometries(meshes.map((ms) => {
          const g = ms.geometry.clone();
          g.applyMatrix4(ms.matrixWorld);
          return g;
        }));
        mtl = meshes[0].material;
      }
      geo = geo.clone();
      geo.computeBoundingBox();
      const size = new THREE.Vector3();
      geo.boundingBox.getSize(size);
      const mat2 = mtl && mtl.clone ? mtl.clone() : new THREE.MeshStandardMaterial({ color: 0x4b7a3c, roughness: 1 });
      registerEnv(mat2, 0.42);
      types.push({ geo, mat: mat2, norm: 7 / (size.y || 7) });
    } catch { /* 单型失败不拖垮整体 */ }
  }

  const sakuraItems = items.filter((it) => it.sakura);
  const greenItems = items.filter((it) => !it.sakura);
  const allMats = [];

  if (types.length) {
    const dummy = new THREE.Object3D();
    const col = new THREE.Color();
    const buckets = types.map(() => []);
    for (const it of greenItems) {
      buckets[Math.min(types.length - 1, (it.t * types.length) | 0)].push(it);
    }
    types.forEach((tp, k) => {
      const bucket = buckets[k];
      if (!bucket.length) return;
      const im = new THREE.InstancedMesh(tp.geo, tp.mat, bucket.length);
      im.frustumCulled = false;
      im.castShadow = true;
      bucket.forEach((it, i) => {
        dummy.position.set(it.x, it.y, it.z);
        dummy.rotation.set(0, it.t * 6.28, 0);
        dummy.scale.setScalar(it.s * tp.norm);
        dummy.updateMatrix();
        im.setMatrixAt(i, dummy.matrix);
        col.setScalar(0.86 + it.c * 0.28);          // 明度微差(固有色之上)
        im.setColorAt(i, col);
      });
      im.instanceMatrix.needsUpdate = true;
      if (im.instanceColor) im.instanceColor.needsUpdate = true;
      group.add(im);
      allMats.push(tp.mat);
    });
  } else {
    // GLB 全挂(离线开发):常规树退回程序化,与樱花同管线
    for (const it of greenItems) sakuraItems.push(it);
  }

  // 樱花(以及 GLB 缺失时的兜底树):程序化干 + 粉团冠
  const n = sakuraItems.length;
  const trunkGeo = new THREE.CylinderGeometry(0.16, 0.26, 1, 6).translate(0, 0.5, 0);
  const crownGeo = new THREE.IcosahedronGeometry(0.5, 0);
  const trunkMat = new THREE.MeshStandardMaterial({ color: 0x6b5340, roughness: 1 });
  const crownMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.95, flatShading: true });
  registerEnv(trunkMat, 0.3);
  registerEnv(crownMat, 0.42);
  const trunk = new THREE.InstancedMesh(trunkGeo, trunkMat, n);
  const crown = new THREE.InstancedMesh(crownGeo, crownMat, n);
  trunk.frustumCulled = false; crown.frustumCulled = false;

  const dummy = new THREE.Object3D();
  const col = new THREE.Color();
  const greens = ['#4b7a3c', '#568a41', '#3d6b34', '#6d9445', '#456f38'];
  const pinks = ['#e8b4c8', '#f0c8d8', '#dd9ebc', '#f4d8e0'];
  sakuraItems.forEach((it, i) => {
    const h = 7 * it.s;
    dummy.position.set(it.x, it.y, it.z);
    dummy.rotation.set(0, it.t * 6.28, 0);
    dummy.scale.set(it.s, h, it.s);
    dummy.updateMatrix();
    trunk.setMatrixAt(i, dummy.matrix);

    const cr = (3.2 + it.c * 1.8) * it.s;
    dummy.position.set(it.x, it.y + h * 0.92, it.z);
    dummy.rotation.set(it.t, it.t * 3.3, it.t * 2.1);
    dummy.scale.set(cr, cr * (0.85 + it.c * 0.4), cr);
    dummy.updateMatrix();
    crown.setMatrixAt(i, dummy.matrix);
    const pal = it.sakura ? pinks : greens;
    col.set(pal[(it.c * pal.length) | 0]).multiplyScalar(0.85 + it.t * 0.3);
    crown.setColorAt(i, col);
  });
  trunk.instanceMatrix.needsUpdate = true;
  crown.instanceMatrix.needsUpdate = true;
  if (crown.instanceColor) crown.instanceColor.needsUpdate = true;
  trunk.castShadow = crown.castShadow = true;
  group.add(trunk, crown);
  allMats.push(trunkMat, crownMat);
  return { group, count: items.length, mats: allMats };
}

/* ============ 路灯(主干道,夜间点亮) ============ */
export function buildStreetLights(centerlines, seed = 777, blocked = null) {
  const rand = makeRandom(seed);
  const group = new THREE.Group();
  group.name = 'streetlights';
  const poles = [], heads = [];
  for (const l of centerlines) {
    if (l.w < 20) continue;
    const pts = l.pts;
    for (let i = 1; i < pts.length; i++) {
      const [ax, az] = pts[i - 1], [bx, bz] = pts[i];
      const d = Math.hypot(bx - ax, bz - az);
      const n = Math.floor(d / 48);
      if (n < 1) continue;
      const dx = (bx - ax) / d, dz = (bz - az) / d;
      // 立杆基准取路面标高(堤式路/高架段不再半埋进路基)
      const ya = l.ys ? l.ys[i - 1] : Math.max(terrainHeight(ax, az), 0);
      const yb = l.ys ? l.ys[i] : Math.max(terrainHeight(bx, bz), 0);
      for (let k = 0; k < n; k++) {
        const t = (k + 0.5) / n;
        const side = ((i + k) % 2 === 0) ? 1 : -1;         // 两侧交替
        const off = (l.w / 2 + 1.5) * side;
        const x = ax + (bx - ax) * t - dz * off;
        const z = az + (bz - az) * t + dx * off;
        if (blocked && blocked(x, z)) continue;            // 不立进楼里
        const gy = ya + (yb - ya) * t;
        poles.push({ x, z, y: gy, w: 0.22, h: 9.5, d: 0.22 });
        // 灯头朝路心内挑 2.2 m(旧式 off*-0.12 方向相反、且随路宽放大到 2.7 m)
        heads.push({ x: x + dz * side * 2.2, z: z - dx * side * 2.2, y: gy + 9.3, w: 1.6, h: 0.5, d: 0.8 });
      }
    }
  }
  const poleMat = mat('#4d5256', { rough: 0.7, metal: 0.3 });
  const poleMesh = instancedBoxes(poles, poleMat, { uvU: 4, uvV: 9 });
  if (poleMesh) { poleMesh.castShadow = false; group.add(poleMesh); }

  const headMat = mat('#fff1c8', { emissive: '#ffdf9e', emissiveIntensity: 0.05, rough: 0.4 });
  headMat.userData.nightGlow = 3.4;
  const headMesh = instancedBoxes(heads, headMat, { uvU: 2, uvV: 2 });
  if (headMesh) { headMesh.castShadow = false; group.add(headMesh); }

  return {
    group, count: poles.length,
    setNight(k) { headMat.emissiveIntensity = 0.05 + k * 3.4; },
  };
}

/* ============ 车流(Kenney CC0 车模实例化;加载失败回退方块) ============ */
export async function buildCars(centerlines, count = 170, seed = 999) {
  const rand = makeRandom(seed);
  const lines = centerlines.filter((l) => l.w >= 24);
  const group = new THREE.Group();
  group.name = 'cars';
  if (!lines.length) return { group, update: () => {}, setNight: () => {} };

  // 车模:合并 GLB → 单几何实例化
  const MODELS = ['./assets/cars/sedan.glb', './assets/cars/taxi.glb', './assets/cars/suv.glb',
    './assets/cars/van.glb', './assets/cars/police.glb', './assets/cars/hatchback-sports.glb'];
  const models = [];
  for (const u of MODELS) {
    const m = await loadMergedGLB(u);
    if (!m) continue;
    // 归一化:4.6 m 长,底面贴 0
    m.geometry.computeBoundingBox();
    const bb = m.geometry.boundingBox;
    const len = Math.max(bb.max.z - bb.min.z, bb.max.x - bb.min.x, 0.01);
    models.push({ ...m, s: 4.6 / len, offY: -bb.min.y * (4.6 / len) });
  }

  const meta = lines.map((l) => {
    const lens = [];
    let total = 0;
    for (let i = 1; i < l.pts.length; i++) {
      const d = Math.hypot(l.pts[i][0] - l.pts[i - 1][0], l.pts[i][1] - l.pts[i - 1][1]);
      lens.push(d); total += d;
    }
    const ys = l.ys || l.pts.map(([x, z]) => Math.max(terrainHeight(x, z), 0) + 0.15);
    return { pts: l.pts, ys, lens, total };
  });

  const dummy = new THREE.Object3D();
  const cars = [];
  let meshes = [];
  const boxMat = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 0.35, metalness: 0.35 });
  registerEnv(boxMat, 1.25);
  const palette = ['#d8dde3', '#3b4250', '#8d3a33', '#2f5b8b', '#c9a227', '#37474f', '#6b7280'];

  if (models.length) {
    // 每车型一个 InstancedMesh,车辆轮流分配
    const perModel = Math.ceil(count / models.length);
    meshes = models.map((m, mi) => {
      const im = new THREE.InstancedMesh(m.geometry, m.material, perModel);
      im.frustumCulled = false;
      im.castShadow = true;
      im.userData = { s: m.s, offY: m.offY, used: 0 };
      group.add(im);
      return im;
    });
    for (let i = 0; i < count; i++) {
      const li = (rand() * lines.length) | 0;
      const mi = i % models.length;
      cars.push({
        li, t: rand(),
        speed: (14 + rand() * 11) / meta[li].total * (rand() > 0.5 ? 1 : -1),
        lane: (rand() > 0.5 ? 1 : -1) * (lines[li].w * 0.22),
        mesh: meshes[mi], idx: meshes[mi].userData.used++,
      });
    }
    for (const im of meshes) im.count = im.userData.used;
  } else {
    // 回退:方块车流
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const im = new THREE.InstancedMesh(geo, boxMat, count);
    im.frustumCulled = false;
    group.add(im);
    meshes = [im];
    const col = new THREE.Color();
    for (let i = 0; i < count; i++) {
      const li = (rand() * lines.length) | 0;
      cars.push({
        li, t: rand(),
        speed: (14 + rand() * 11) / meta[li].total * (rand() > 0.5 ? 1 : -1),
        lane: (rand() > 0.5 ? 1 : -1) * (lines[li].w * 0.22),
        mesh: im, idx: i, box: true,
      });
      col.set(palette[(rand() * palette.length) | 0]);
      im.setColorAt(i, col);
    }
    if (im.instanceColor) im.instanceColor.needsUpdate = true;
  }

  function sample(m, t, offset) {
    let target = (((t % 1) + 1) % 1) * m.total;
    for (let i = 0; i < m.lens.length; i++) {
      if (target <= m.lens[i] || i === m.lens.length - 1) {
        const f = m.lens[i] ? Math.min(1, target / m.lens[i]) : 0;
        const ax = m.pts[i][0], az = m.pts[i][1], bx = m.pts[i + 1][0], bz = m.pts[i + 1][1];
        const dx = bx - ax, dz = bz - az;
        const len = Math.hypot(dx, dz) || 1;
        const x = ax + dx * f, z = az + dz * f;
        const y = m.ys[i] + (m.ys[i + 1] - m.ys[i]) * f;
        return [x + (-dz / len) * offset, z + (dx / len) * offset, Math.atan2(dx, dz), y];
      }
      target -= m.lens[i];
    }
    return [0, 0, 0, 0];
  }

  function update(dt) {
    for (let i = 0; i < cars.length; i++) {
      const c = cars[i];
      c.t += c.speed * dt;
      const m = meta[c.li];
      const [x, z, ang, y] = sample(m, c.t, c.lane);
      const ud = c.mesh.userData;
      if (c.box) {
        dummy.position.set(x, y + 0.75, z);
        dummy.scale.set(1.8, 1.5, 4.6);
      } else {
        dummy.position.set(x, y + ud.offY, z);
        dummy.scale.setScalar(ud.s);
      }
      dummy.rotation.set(0, ang, 0);
      dummy.updateMatrix();
      c.mesh.setMatrixAt(c.idx, dummy.matrix);
    }
    for (const im of meshes) im.instanceMatrix.needsUpdate = true;
  }

  function setNight(k) {
    boxMat.emissive = new THREE.Color(0xffd9a0);
    boxMat.emissiveIntensity = k * 0.55;
    // Kenney 车模无自发光;夜间由路灯/车灯环境承担
  }

  return { group, update, setNight, count, mats: [boxMat] };
}

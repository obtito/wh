// 桥梁层:武汉长江大桥(公铁双层桁架) / 二桥(斜拉) / 鹦鹉洲(三塔悬索) / 汉江拱桥群
// 桥面高程剖面 deckY(t):两端接地形,主段抬到 deckH —— 供车辆行驶查询(bridgeHeightAt)
import * as THREE from 'three';
import { toV2, clamp, smoothstep, lerp } from './geo.js';
import { BRIDGES } from './data.js';
import { mat, put, UNIT, instancedBoxes, registerEnv } from './lib.js';
import { terrainHeight } from './world.js';

/* ---------- 通用:桥轴线几何 ---------- */
function axisInfo(br) {
  const [ax, az] = toV2(...br.axis[0]);
  const [bx, bz] = toV2(...br.axis[1]);
  const dx = bx - ax, dz = bz - az;
  const L = Math.hypot(dx, dz);
  return { ax, az, bx, bz, dx: dx / L, dz: dz / L, px: -dz / L, pz: dx / L, L };
}

/** 桥面高度剖面:t=0/1 端点接岸(水上端点至少 3.5 m,避免引桥端插水),approach 段 smoothstep 爬升到 deckH */
function makeDeckY(br, info) {
  const water0 = Math.max(terrainHeight(info.ax, info.az), 0) < 1;      // 端点在水域/岸边
  const water1 = Math.max(terrainHeight(info.bx, info.bz), 0) < 1;
  const y0 = Math.max(terrainHeight(info.ax, info.az), water0 ? 3.5 : 2);
  const y1 = Math.max(terrainHeight(info.bx, info.bz), water1 ? 3.5 : 2);
  const top = br.deckH;
  const app = br.approach ?? 0.16;
  return (t) => {
    if (t < app) return lerp(y0, top, smoothstep(t / app));
    if (t > 1 - app) return lerp(top, y1, smoothstep((t - (1 - app)) / app));
    return top;
  };
}

/** 沿桥轴采样 3D 中心线 */
function sampleDeck(info, deckY, n = 40) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const t = i / n;
    const x = info.ax + info.dx * info.L * t;
    const z = info.az + info.dz * info.L * t;
    pts.push([x, deckY(t), z]);
  }
  return pts;
}

/** 带状桥面(沿 3D 中心线,自阴影箱梁) */
function deckRibbon(info, pts, w, thick = 2.2, color = '#5c6167') {
  const items = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const [x1, y1, z1] = pts[i];
    const [x2, y2, z2] = pts[i + 1];
    const len = Math.hypot(x2 - x1, z2 - z1);
    const cx = (x1 + x2) / 2, cz = (z1 + z2) / 2, cy = (y1 + y2) / 2;
    items.push({ x: cx, z: cz, y: cy - thick / 2, w, h: thick, d: len * 1.02, rot: Math.atan2(x2 - x1, z2 - z1) });
  }
  return instancedBoxes(items, mat(color, { rough: 0.8, metal: 0.2, env: 0.5 }), { uvU: 30, uvV: 30 });
}

/** 桥面行驶走廊注册表 */
const DECKS = [];   // { pts2: [[x,z]], cum, total, w, yAt(t) }
export function bridgeHeightAt(x, z) {
  for (const d of DECKS) {
    // 快速包围盒
    if (x < d.minX - 60 || x > d.maxX + 60 || z < d.minZ - 60 || z > d.maxZ + 60) continue;
    // 找最近线段
    let best = Infinity, bt = 0;
    for (let i = 0; i < d.pts2.length - 1; i++) {
      const ax = d.pts2[i][0], az = d.pts2[i][1];
      const bx = d.pts2[i + 1][0], bz = d.pts2[i + 1][1];
      const dx = bx - ax, dz = bz - az;
      const l2 = dx * dx + dz * dz || 1;
      let t = ((x - ax) * dx + (z - az) * dz) / l2;
      t = clamp(t, 0, 1);
      const px = ax + dx * t, pz = az + dz * t;
      const dist = Math.hypot(x - px, z - pz);
      if (dist < best) { best = dist; bt = (i + t) / (d.pts2.length - 1); }
    }
    if (best <= d.w / 2 + 3) return d.yAt(bt);
  }
  return null;
}

function registerDeck(br, info, pts, w, deckY) {
  const pts2 = pts.map(([x, , z]) => [x, z]);
  let minX = Infinity, maxX = -Infinity, minZ = Infinity, maxZ = -Infinity;
  for (const [x, z] of pts2) {
    minX = Math.min(minX, x); maxX = Math.max(maxX, x);
    minZ = Math.min(minZ, z); maxZ = Math.max(maxZ, z);
  }
  DECKS.push({ pts2, w, minX, maxX, minZ, maxZ, yAt: deckY });
}

/* ==================== 1. 武汉长江大桥:公铁双层桁架 ==================== */
function buildTrussBridge(br, group, updates) {
  const info = axisInfo(br);
  const deckY = makeDeckY(br, info);
  const roadW = 22;
  const pts = sampleDeck(info, deckY, 44);
  registerDeck(br, info, pts, roadW, deckY);

  const steel = mat('#8b9096', { rough: 0.55, metal: 0.5, env: 0.8 });       // 米黄钢桁(远看浅灰)
  const steelDark = mat('#6d7278', { rough: 0.6, metal: 0.45 });

  // 上层公路桥面
  const roadDeck = deckRibbon(info, pts, roadW, 1.8, '#4a4d52');
  roadDeck.name = 'yb-road-deck';
  group.add(roadDeck);
  // 下层铁路桥面(y-8)
  const railPts = pts.map(([x, y, z]) => [x, y - 8, z]);
  group.add(deckRibbon(info, railPts, 16, 1.2, '#3d4045'));

  // 主桁架:两侧立面,每 panel 一组 竖杆+斜杆(米字),弦杆为通长箱
  const panels = 26;
  const trussItems = [];
  const topY = (t) => deckY(t) + 9.5;      // 上弦
  const botY = (t) => deckY(t) - 8.5;      // 下弦
  for (const side of [-1, 1]) {
    const off = (roadW / 2 + 1) * side;
    for (let i = 0; i <= panels; i++) {
      const t = i / panels;
      const x = info.ax + info.dx * info.L * t + info.px * off;
      const z = info.az + info.dz * info.L * t + info.pz * off;
      // 竖杆
      trussItems.push({ x, z, y: botY(t), w: 1.1, h: topY(t) - botY(t), d: 1.1, rot: Math.atan2(info.dx, info.dz) });
      // 斜杆(交替方向 → 米字)
      if (i < panels) {
        const t2 = (i + 1) / panels;
        const x2 = info.ax + info.dx * info.L * t2 + info.px * off;
        const z2 = info.az + info.dz * info.L * t2 + info.pz * off;
        for (const dir of [1, -1]) {
          const yA = dir > 0 ? topY(t) : botY(t);
          const yB = dir > 0 ? botY(t2) : topY(t2);
          const cy = (yA + yB) / 2;
          const len = Math.hypot(info.L / panels, topY(t) - botY(t));
          trussItems.push({
            x: (x + x2) / 2, z: (z + z2) / 2, y: cy - len / 2, w: 0.7, h: len, d: 0.7,
            rot: Math.atan2(x2 - x, z2 - z),
            rotX: Math.atan2(topY(t) - botY(t), info.L / panels) * dir,
          });
        }
        // 上/下平联(顶面/底面横撑)
        if (side === 1) {
          const xx2 = info.ax + info.dx * info.L * t2 - info.px * off;
          const zz2 = info.az + info.dz * info.L * t2 - info.pz * off;
          trussItems.push({ x: (x + xx2) / 2, z: (z + zz2) / 2, y: topY(t), w: roadW + 2, h: 0.8, d: 1.0, rot: Math.atan2(info.dx, info.dz) + Math.PI / 2 });
        }
      }
    }
  }
  const truss = instancedBoxes(trussItems, steel, { uvU: 20, uvV: 20 });
  if (truss) { truss.name = 'yb-truss'; group.add(truss); }

  // 桥墩:主段等距 8 墩,从水面抬到下弦
  const pierMat = mat('#9aa0a4', { rough: 0.9 });
  const piers = [];
  for (let i = 1; i <= 8; i++) {
    const t = 0.18 + (i / 9) * 0.64;
    const x = info.ax + info.dx * info.L * t;
    const z = info.az + info.dz * info.L * t;
    const top = botY(t);
    piers.push({ x, z, y: -4, w: 10, h: top + 4, d: 26, rot: Math.atan2(info.dx, info.dz) + Math.PI / 2 });
    piers.push({ x, z, y: top, w: 12.5, h: 1.8, d: 28, rot: Math.atan2(info.dx, info.dz) + Math.PI / 2 });  // 墩帽
  }
  const pierMesh = instancedBoxes(piers, pierMat, { uvU: 30, uvV: 30 });
  if (pierMesh) { pierMesh.name = 'yb-piers'; group.add(pierMesh); }

  // 桥头堡:两端塔楼 + 绿色攒尖顶(历史风貌标志)
  const gateMat = mat('#b8b2a2', { rough: 0.85 });
  const roofMat = mat('#3d5a45', { rough: 0.6 });
  for (const [t, sgn] of [[0.055, 1], [0.945, -1]]) {
    const x = info.ax + info.dx * info.L * t + info.px * (roadW / 2 + 6) * sgn;
    const z = info.az + info.dz * info.L * t + info.pz * (roadW / 2 + 6) * sgn;
    const gy = deckY(t);
    put(group, UNIT.box, gateMat, { pos: [x, gy, z], scale: [9, 22, 9] });
    put(group, UNIT.cyl, gateMat, { pos: [x, gy + 22, z], scale: [7, 3, 7] });
    put(group, UNIT.cone4, roofMat, { pos: [x, gy + 25, z], scale: [8, 6, 8], rot: Math.PI / 4 });
    // 另一侧对称
    const x2 = info.ax + info.dx * info.L * t - info.px * (roadW / 2 + 6) * sgn;
    const z2 = info.az + info.dz * info.L * t - info.pz * (roadW / 2 + 6) * sgn;
    put(group, UNIT.box, gateMat, { pos: [x2, gy, z2], scale: [9, 22, 9] });
    put(group, UNIT.cyl, gateMat, { pos: [x2, gy + 22, z2], scale: [7, 3, 7] });
    put(group, UNIT.cone4, roofMat, { pos: [x2, gy + 25, z2], scale: [8, 6, 8], rot: Math.PI / 4 });
  }

  // 列车(下层铁路,8 节,往返动画)
  const trainMat = mat('#c8ccd2', { rough: 0.4, metal: 0.3 });
  const cars = 10;
  const trainMesh = new THREE.InstancedMesh(UNIT.box, trainMat, cars);
  trainMesh.frustumCulled = false;
  trainMesh.castShadow = true;
  group.add(trainMesh);
  const dummy = new THREE.Object3D();
  let trainT = 0;
  updates.push((dt) => {
    trainT = (trainT + dt * 0.022) % 2;      // 0-2 往返
    const t0 = trainT < 1 ? trainT : 2 - trainT;
    for (let i = 0; i < cars; i++) {
      const t = clamp(t0 + (i - cars / 2) * 0.011, 0.02, 0.98);
      const x = info.ax + info.dx * info.L * t;
      const z = info.az + info.dz * info.L * t;
      dummy.position.set(x, deckY(t) - 8 + 2.4, z);
      dummy.rotation.set(0, Math.atan2(info.dx, info.dz), 0);
      dummy.scale.set(3.2, 4.2, 22);
      dummy.updateMatrix();
      trainMesh.setMatrixAt(i, dummy.matrix);
    }
    trainMesh.instanceMatrix.needsUpdate = true;
  });

  return { br, info, deckY };
}

/* ==================== 2. 斜拉桥(二桥) ==================== */
function buildCableStayed(br, group) {
  const info = axisInfo(br);
  const deckY = makeDeckY(br, info);
  const roadW = 26;
  const pts = sampleDeck(info, deckY, 40);
  registerDeck(br, info, pts, roadW, deckY);

  group.add(deckRibbon(info, pts, roadW, 3.0, '#5c6167'));

  const towerMat = mat('#aab0b6', { rough: 0.7 });
  const towerH = br.heightM || 90;

  // 双塔:位于主段 1/3 与 2/3
  const towerTs = [0.36, 0.64];
  const cablePts = [];
  for (const tt of towerTs) {
    const tx = info.ax + info.dx * info.L * tt;
    const tz = info.az + info.dz * info.L * tt;
    const topY = deckY(tt) + towerH;
    // 塔柱(双柱 + 上下横梁的门形塔)
    for (const side of [-1, 1]) {
      const bx = tx + info.px * (roadW / 2 + 2) * side;
      const bz = tz + info.pz * (roadW / 2 + 2) * side;
      put(group, UNIT.box, towerMat, {
        pos: [bx, deckY(tt) - 10, bz],
        scale: [5, towerH + 14, 5],
        rot: Math.atan2(info.dx, info.dz),
      });
    }
    // 塔顶段(两腿合并)
    put(group, UNIT.box, towerMat, { pos: [tx, topY - 12, tz], scale: [5, 24, 5], rot: Math.atan2(info.dx, info.dz) });
    // 拉索:从塔顶放射到桥面两侧锚点
    for (let k = 1; k <= 9; k++) {
      for (const dir of [-1, 1]) {
        const t = clamp(tt + dir * k * 0.052, 0.16, 0.84);
        const axx = info.ax + info.dx * info.L * t + info.px * (roadW * 0.32);
        const azz = info.az + info.dz * info.L * t + info.pz * (roadW * 0.32);
        cablePts.push(tx, topY - 2, tz, axx, deckY(t) + 1, azz);
        const axx2 = info.ax + info.dx * info.L * t - info.px * (roadW * 0.32);
        const azz2 = info.az + info.dz * info.L * t - info.pz * (roadW * 0.32);
        cablePts.push(tx, topY - 2, tz, axx2, deckY(t) + 1, azz2);
      }
    }
  }
  // 拉索用 LineSegments(细但量大便宜)
  const cgeo = new THREE.BufferGeometry();
  cgeo.setAttribute('position', new THREE.Float32BufferAttribute(cablePts, 3));
  const cables = new THREE.LineSegments(cgeo, new THREE.LineBasicMaterial({ color: 0xd8dde2, transparent: true, opacity: 0.85 }));
  cables.frustumCulled = false;
  group.add(cables);

  return { br, info, deckY };
}

/* ==================== 3. 三塔四跨悬索(鹦鹉洲) ==================== */
function buildSuspension3(br, group) {
  const info = axisInfo(br);
  const deckY = makeDeckY(br, info);
  const roadW = 30;
  const pts = sampleDeck(info, deckY, 40);
  registerDeck(br, info, pts, roadW, deckY);

  const orange = mat(br.color || '#d1691f', { rough: 0.6, metal: 0.3 });
  const orangeDark = mat('#b5571c', { rough: 0.65, metal: 0.3 });
  group.add(deckRibbon(info, pts, roadW, 3.2, br.color || '#d1691f'));

  const towerH = br.heightM || 129;
  const towerTs = [0.22, 0.5, 0.78];
  const sag = towerH * 0.30;

  // 主缆抛物线(相邻塔之间 + 两端锚)
  const cablePts = [];
  const mainY = (t) => deckY(t) + towerH;
  const spanCable = (t0, t1, y0, y1, anchored) => {
    const n = 24;
    let prev = null;
    for (let i = 0; i <= n; i++) {
      const f = i / n;
      const t = lerp(t0, t1, f);
      const ty = lerp(y0, y1, f) - (anchored ? sag * 0.6 : sag) * 4 * f * (1 - f);
      const x = info.ax + info.dx * info.L * t;
      const z = info.az + info.dz * info.L * t;
      if (prev) {
        cablePts.push(prev[0], prev[1], prev[2], x, ty, z);
        // 吊杆(每隔 2 点)
        if (i % 2 === 0) cablePts.push(x, ty, z, x, deckY(t) + 1.5, z);
      }
      prev = [x, ty, z];
    }
  };
  for (let i = 0; i < towerTs.length - 1; i++) {
    spanCable(towerTs[i], towerTs[i + 1], mainY(towerTs[i]), mainY(towerTs[i + 1]), false);
  }
  spanCable(0.10, towerTs[0], deckY(0.10) + 4, mainY(towerTs[0]), true);
  spanCable(towerTs[2], 0.90, mainY(towerTs[2]), deckY(0.90) + 4, true);

  // 三塔(门形:两柱 + 横梁),橙色
  for (const tt of towerTs) {
    const tx = info.ax + info.dx * info.L * tt;
    const tz = info.az + info.dz * info.L * tt;
    for (const side of [-1, 1]) {
      const bx = tx + info.px * (roadW / 2 + 3) * side;
      const bz = tz + info.pz * (roadW / 2 + 3) * side;
      put(group, UNIT.box, orange, { pos: [bx, deckY(tt) + towerH / 2 - 4, bz], scale: [6, towerH + 4, 6] });
    }
    put(group, UNIT.box, orangeDark, {
      pos: [tx, deckY(tt) + towerH - 8, tz], scale: [roadW + 12, 5, 5],
      rot: Math.atan2(info.px, info.pz),
    });
    put(group, UNIT.box, orangeDark, {
      pos: [tx, deckY(tt) + towerH * 0.45, tz], scale: [roadW + 8, 4, 4],
      rot: Math.atan2(info.px, info.pz),
    });
  }

  const cgeo = new THREE.BufferGeometry();
  cgeo.setAttribute('position', new THREE.Float32BufferAttribute(cablePts, 3));
  const cables = new THREE.LineSegments(cgeo, new THREE.LineBasicMaterial({ color: 0xe07b2e }));
  cables.frustumCulled = false;
  group.add(cables);

  return { br, info, deckY };
}

/* ==================== 4. 拱桥(汉江:江汉桥 / 晴川桥) ==================== */
function buildArchBridge(br, group) {
  const info = axisInfo(br);
  const deckY = makeDeckY(br, info);
  const roadW = 22;
  const pts = sampleDeck(info, deckY, 30);
  registerDeck(br, info, pts, roadW, deckY);
  group.add(deckRibbon(info, pts, roadW, 2.2, '#5c6167'));

  const archMat = mat(br.color || '#9aa0a4', { rough: 0.5, metal: 0.4, env: 0.8 });
  const rise = br.heightM || 30;

  // 拱肋:抛物线沿桥轴(两片)
  const segN = 22;
  for (const side of [-1, 1]) {
    let prev = null;
    const ribItems = [];
    for (let i = 0; i <= segN; i++) {
      const t = 0.14 + (i / segN) * 0.72;
      const y = deckY(0.5) - 2 + rise * 4 * ((i / segN) * (1 - i / segN));
      const x = info.ax + info.dx * info.L * t + info.px * (roadW / 2 - 1) * side;
      const z = info.az + info.dz * info.L * t + info.pz * (roadW / 2 - 1) * side;
      if (prev) {
        const len = Math.hypot(info.L * 0.72 / segN, y - prev[1]);
        ribItems.push({ x: (x + prev[0]) / 2, z: (z + prev[2]) / 2, y: Math.min(y, prev[1]), w: 2.2, h: len, d: 2.2, rot: Math.atan2(x - prev[0], z - prev[2]) });
      }
      prev = [x, y, z];
    }
    const m = instancedBoxes(ribItems, archMat, { uvU: 12, uvV: 12 });
    if (m) group.add(m);
  }
  // 吊杆
  const hangerPts = [];
  for (let i = 1; i < segN; i += 2) {
    const t = 0.14 + (i / segN) * 0.72;
    const y = deckY(0.5) - 2 + rise * 4 * ((i / segN) * (1 - i / segN));
    const x = info.ax + info.dx * info.L * t;
    const z = info.az + info.dz * info.L * t;
    hangerPts.push(x, y, z, x, deckY(t) + 1, z);
  }
  const hg = new THREE.BufferGeometry();
  hg.setAttribute('position', new THREE.Float32BufferAttribute(hangerPts, 3));
  group.add(new THREE.LineSegments(hg, new THREE.LineBasicMaterial({ color: 0xc8ccd2 })));

  return { br, info, deckY };
}

/* ==================== 桥体夜景灯带 ==================== */
/** 沿桥面两侧拉两串暖光点(灯柱间距 24 m,用小实例块) */
function deckLights(info, deckY, roadW, group, lightAgg) {
  const items = [];
  for (const side of [-1, 1]) {
    const off = (roadW / 2 - 0.6) * side;
    const n = Math.floor(info.L / 24);
    for (let i = 0; i <= n; i++) {
      const t = i / n;
      const x = info.ax + info.dx * info.L * t + info.px * off;
      const z = info.az + info.dz * info.L * t + info.pz * off;
      items.push({ x, z, y: deckY(t) + 1.5, w: 0.5, h: 1.4, d: 0.5, rot: Math.atan2(info.dx, info.dz) });
    }
  }
  const lm = mat('#ffe2a8', { emissive: '#ffcf82', emissiveIntensity: 0.06, rough: 0.4 });
  lm.userData.nightGlow = 3.6;
  lightAgg.push(lm);
  const mesh = instancedBoxes(items, lm, { uvU: 2, uvV: 2 });
  if (mesh) { mesh.castShadow = false; group.add(mesh); }
}

/* ==================== 汇总 ==================== */
export function buildBridges() {
  const group = new THREE.Group();
  group.name = 'bridges';
  const updates = [];
  const lightMats = [];
  for (const br of BRIDGES) {
    const info = axisInfo(br);
    const deckY = makeDeckY(br, info);
    if (br.kind === 'truss') buildTrussBridge(br, group, updates);
    else if (br.kind === 'cablestayed') buildCableStayed(br, group);
    else if (br.kind === 'suspension3') buildSuspension3(br, group);
    else if (br.kind === 'arch') buildArchBridge(br, group);
    deckLights(info, deckY, br.kind === 'truss' ? 22 : 26, group, lightMats);
  }
  return {
    group, updates,
    setNight(k) { for (const m of lightMats) m.emissiveIntensity = 0.06 + k * 3.6; },
  };
}

// 地标层:16 处武汉地标精建(程序化)
// 高度口径:各构建器总高 ≈ data.js 的 heightM(供自动校验)
import * as THREE from 'three';
import { toV2, bearingToRot, makeRandom } from './geo.js';
import { LANDMARKS } from './data.js';
import { mat, put, UNIT, instancedBoxes, registerEnv } from './lib.js';
import { terrainHeight } from './world.js';
import { chineseHall, storiedPavilion, hipRoof, gableRoof, pedestal } from './arch.js';

/* ============ 地标占地(供城市生成排他) ============
 * 单一事实来源迁到 js/sites.js(烘焙工具/程序化城市/运行时共用),
 * 这里原样转发,保持既有 import 不变。 */
export { SITE_R, landmarkSites } from './sites.js';

/* ============ 工具 ============ */
function groundAt(x, z) { return Math.max(terrainHeight(x, z), 0); }

/* ==================== 1. 黄鹤楼 ==================== */
// 五层飞檐攒尖,黄琉璃,葫芦宝顶,高 51.4 m(不含蛇山地形)
function mkHuangelou(g, x, z, ground, rot) {
  const platform = pedestal(46, 46, 6, '#cfc9b8');
  platform.position.set(x, ground, z);
  platform.rotation.y = rot;
  g.add(platform);

  const tower = storiedPavilion({
    floors: [
      { w: 33, d: 33, h: 8.6 }, { w: 29, d: 29, h: 7.6 },
      { w: 25, d: 25, h: 6.8 }, { w: 21, d: 21, h: 6.2 },
      { w: 17.5, d: 17.5, h: 5.6 },
    ],
    eaveW: 40,
    topRoof: 7.2,
    topType: 'jian',                      // 攒尖
    finial: true,
    postColor: '#8e2f22',
    wallColor: '#d8cdb8',
    roofColor: '#dcae32',
    stoneColor: '#cfc9b8',
    bays: 7,
  });
  tower.position.set(x, ground + 6, z);
  tower.rotation.y = rot;
  g.add(tower);

  // 夜间金色泛光(黄色琉璃屋面自发光)
  const gold = new THREE.Color('#dcae32');
  tower.traverse((o) => {
    if (o.isMesh && o.material?.color) {
      const c = o.material.color;
      if (Math.abs(c.r - gold.r) < 0.02 && Math.abs(c.g - gold.g) < 0.02 && Math.abs(c.b - gold.b) < 0.02) {
        o.material = o.material.clone();
        o.material.emissive = new THREE.Color('#7a5510');
        o.material.userData.nightGlow = 1.4;
      }
    }
  });
}

/* ==================== 2. 龟山电视塔 ==================== */
function mkTvtower(g, x, z, ground) {
  const white = mat('#dfe2e4', { rough: 0.6, env: 0.6 });
  // 塔身:束腰混凝土桅杆(分段圆柱,微收分)
  const segs = [
    [9.5, 0, 22], [7.5, 22, 52], [5.8, 74, 46], [4.4, 120, 14],
  ];
  let y = ground;
  for (const [r, dy, h] of segs) {
    put(g, UNIT.cyl, white, { pos: [x, y + dy, z], scale: [r * 2, h, r * 2] });
  }
  // 观光球(塔身 128 m 处)
  const podY = ground + 128;
  put(g, UNIT.cyl, white, { pos: [x, podY, z], scale: [26, 9, 26] });
  put(g, UNIT.cyl, mat('#3d6b8f', { rough: 0.3, metal: 0.5, env: 1.2 }), { pos: [x, podY + 4.5, z], scale: [22, 1.2, 22] });
  put(g, UNIT.cyl, white, { pos: [x, podY + 9, z], scale: [19, 3, 19] });
  // 天线桅杆(红白段)
  const mast = mat('#c8ccd2', { metal: 0.5, rough: 0.4 });
  const red = mat('#b03030', { rough: 0.6 });
  put(g, UNIT.cyl, mast, { pos: [x, ground + 174, z], scale: [5, 40, 5] });
  for (let i = 0; i < 5; i++) {
    put(g, UNIT.cyl, i % 2 ? red : mast, { pos: [x, ground + 196 + i * 5, z], scale: [2.2 - i * 0.3, 5, 2.2 - i * 0.3] });
  }
}

/* ==================== 3. 晴川阁 ==================== */
function mkQingchuan(g, x, z, ground, rot) {
  const pav = storiedPavilion({
    floors: [{ w: 16, d: 11, h: 6.5 }, { w: 13, d: 9, h: 5.5 }],
    eaveW: 19,
    topRoof: 5.5,
    topType: 'gable-hip',
    finial: false,
    postColor: '#8e2f22',
    wallColor: '#c9b6a2',
    roofColor: '#3a4045',
    stoneColor: '#cfc9b8',
    bays: 5,
  });
  pav.position.set(x, ground, z);
  pav.rotation.y = rot;
  g.add(pav);
  // 禹功矶驳岸 + 矮墙
  const wall = mat('#b8b2a2', { rough: 0.95 });
  put(g, UNIT.box, wall, { pos: [x, ground + 1.5, z], scale: [34, 3, 0.8], rot });
}

/* ==================== 4. 江汉关大楼 ==================== */
function mkJianghanguan(g, x, z, ground, rot) {
  const stone = mat('#c9c2ae', { rough: 0.85 });
  const stoneDark = mat('#a89f8a', { rough: 0.9 });
  // 主体 4 层(40×22×24)+ 阁楼层
  put(g, UNIT.box, stone, { pos: [x, ground + 12, z], scale: [40, 24, 22], rot });
  put(g, UNIT.box, stoneDark, { pos: [x, ground + 24.5, z], scale: [41.5, 3, 23.5], rot });
  // 立面柱廊(两层,10 开间)
  const cols = [];
  const cRad = 0.8;
  for (let i = 0; i < 11; i++) {
    const off = -19 + i * 3.8;
    const wx = Math.cos(rot) * off, wz = Math.sin(rot) * off;
    cols.push({ x: x + wx + Math.sin(rot) * 11.2, z: z + wz + Math.cos(rot) * 11.2, y: ground, w: cRad * 2, h: 22, d: cRad * 2 });
    cols.push({ x: x + wx - Math.sin(rot) * 11.2, z: z + wz - Math.cos(rot) * 11.2, y: ground, w: cRad * 2, h: 22, d: cRad * 2 });
  }
  const colMesh = instancedBoxes(cols, mat('#d8d2c0', { rough: 0.8 }), { uvU: 8, uvV: 8 });
  if (colMesh) g.add(colMesh);
  // 钟楼(方形塔 + 白盘 + 尖顶)
  const towerBase = ground + 26;
  put(g, UNIT.box, stone, { pos: [x, towerBase + 5, z], scale: [9, 10, 9], rot });
  // 钟面(四面)
  const dial = mat('#f2efe6', { rough: 0.5, emissive: '#6a5a30', emissiveIntensity: 0 });
  const hands = mat('#222222');
  for (const a of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
    const dx = Math.sin(rot + a) * 4.8, dz = Math.cos(rot + a) * 4.8;
    const face = put(g, UNIT.box, dial, { pos: [x + dx, towerBase + 6.5, z + dz], scale: [5.2, 5.2, 0.4], rot: rot + a });
    face.userData.nightGlow = 1.2;
    put(g, UNIT.box, hands, { pos: [x + dx * 1.05, towerBase + 6.8, z + dz * 1.05], scale: [0.35, 2.2, 0.3], rot: rot + a, rotX: 0 });
    put(g, UNIT.box, hands, { pos: [x + dx * 1.05, towerBase + 6.1, z + dz * 1.05], scale: [0.3, 1.4, 0.3], rot: rot + a });
  }
  put(g, UNIT.box, stone, { pos: [x, towerBase + 11.5, z], scale: [7, 3, 7], rot });
  put(g, UNIT.cone4, mat('#3f4a44', { rough: 0.7 }), { pos: [x, towerBase + 14, z], scale: [7.5, 6, 7.5], rot: Math.PI / 4 + rot });
  put(g, UNIT.cyl, hands, { pos: [x, towerBase + 20.3, z], scale: [0.24, 1.6, 0.24] });
}

/* ==================== 5. 江汉路步行街(入口牌坊 + 铜像) ==================== */
function mkJianghanlu(g, x, z, ground, rot) {
  const gold = mat('#c9a227', { metal: 0.6, rough: 0.35, env: 1.0 });
  const red = mat('#9a3324', { rough: 0.8 });
  // 四柱三门牌坊
  for (const off of [-14, -4.5, 4.5, 14]) {
    const wx = Math.cos(rot) * off, wz = Math.sin(rot) * off;
    put(g, UNIT.cyl, red, { pos: [x + wx, ground, z + wz], scale: [1.6, 11, 1.6] });
  }
  for (const [hgt, len] of [[10.2, 34], [12.5, 24]]) {
    put(g, UNIT.box, gold, { pos: [x, ground + hgt, z], scale: [len, 1.4, 1.8], rot });
  }
  put(g, UNIT.box, gold, { pos: [x, ground + 14, z], scale: [26, 2.6, 2.2], rot });
  // 铜像
  const bronze = mat('#7a6a4a', { metal: 0.7, rough: 0.4, env: 1.0 });
  put(g, UNIT.cyl, bronze, { pos: [x + Math.cos(rot) * 8, ground, z + Math.sin(rot) * 8], scale: [3, 2.4, 3] });
  put(g, UNIT.sphere, bronze, { pos: [x + Math.cos(rot) * 8, ground + 3.4, z + Math.sin(rot) * 8], scale: [1.4, 2.0, 1.4] });
}

/* ==================== 6. 汉口江滩(堤 + 芦苇 + 灯柱) ==================== */
function mkJiangtan(g, x, z, ground) {
  const rand = makeRandom(4321);
  const leveeMat = mat('#b0a890', { rough: 0.95 });
  const pathMat = mat('#a8a498', { rough: 0.95 });
  // 堤顶步道(长 1400 m,顺江弧线)
  const rot = bearingToRot(38);
  const len = 1400;
  for (let i = 0; i < 46; i++) {
    const t = (i / 45 - 0.5) * len;
    const cx = x + Math.cos(rot) * t;
    const cz = z - Math.sin(rot) * t * 0.42;
    const curve = Math.sin(t / len * Math.PI) * 60;
    put(g, UNIT.box, leveeMat, {
      pos: [cx + Math.sin(rot) * curve, ground + 1.4, cz + Math.cos(rot) * curve],
      scale: [12, 2.8, 34], rot: rot + t * 0.0002,
    });
    if (i % 2 === 0) {
      put(g, UNIT.box, pathMat, {
        pos: [cx + Math.sin(rot) * (curve - 18), ground + 0.1, cz + Math.cos(rot) * (curve - 18)],
        scale: [4, 0.24, 34], rot: rot + t * 0.0002,
      });
    }
    // 灯柱
    if (i % 3 === 0) {
      put(g, UNIT.cyl, mat('#4d5256', { metal: 0.4 }), {
        pos: [cx + Math.sin(rot) * curve + 7, ground + 2.8, cz + Math.cos(rot) * curve + 7],
        scale: [0.5, 5, 0.5],
      });
    }
  }
  // 芦苇荡
  const reedItems = [];
  for (let i = 0; i < 620; i++) {
    const t = (rand() - 0.5) * len;
    const off = (rand() - 0.5) * 90;
    const cx = x + Math.cos(rot) * t + Math.sin(rot) * off;
    const cz = z - Math.sin(rot) * t * 0.42 + Math.cos(rot) * off;
    reedItems.push({ x: cx, z: cz, y: ground, w: 0.5 + rand() * 0.7, h: 2.2 + rand() * 2.4, d: 0.5 + rand() * 0.7, rot: rand() * 3.14, tint: ['#b8a45e', '#c4b26a', '#a89a52'][(rand() * 3) | 0] });
  }
  const reeds = instancedBoxes(reedItems, mat('#ffffff', { rough: 1 }), { uvU: 4, uvV: 4 });
  if (reeds) g.add(reeds);
}

/* ==================== 7. 湖北省博物馆 ==================== */
function mkMuseum(g, x, z, ground, rot) {
  const stone = mat('#cfc8b6', { rough: 0.85 });
  // 高台
  put(g, UNIT.box, stone, { pos: [x, ground, z], scale: [150, 3.4, 76], rot });
  // 主馆(楚风大坡顶)
  const main = new THREE.Group();
  const bodyMat = mat('#5d6a66', { rough: 0.35, metal: 0.3, env: 0.9 });   // 玻璃幕墙
  put(main, UNIT.box, bodyMat, { pos: [0, 1.7, 0], scale: [64, 20, 34] });
  const roof = gableRoof({ w: 74, d: 44, rise: 9, color: '#3c4642', ridgeColor: '#2c3430', segX: 16, segZ: 14 });
  roof.position.y = 21.7;
  main.add(roof);
  // 编钟纹檐口(金线)
  put(main, UNIT.box, mat('#c9a227', { metal: 0.6, rough: 0.3 }), { pos: [0, 20.6, 0], scale: [70, 1.2, 40] });
  main.position.set(x, ground + 3.4, z);
  main.rotation.y = rot + Math.PI / 2;
  g.add(main);
  // 两侧翼馆
  for (const side of [-1, 1]) {
    const wx = Math.sin(rot + Math.PI / 2) * 52 * side;
    const wz = Math.cos(rot + Math.PI / 2) * 52 * side;
    put(g, UNIT.box, stone, { pos: [x + wx, ground + 3.4, z + wz], scale: [42, 12, 26], rot: rot + Math.PI / 2 });
    const r2 = gableRoof({ w: 46, d: 30, rise: 4.5, color: '#3c4642', segX: 12, segZ: 10 });
    r2.position.set(x + wx, ground + 15.4, z + wz);
    r2.rotation.y = rot + Math.PI / 2;
    g.add(r2);
  }
  // 前广场编钟阵列(三排青铜钟)
  const bronze = mat('#6f7a4a', { metal: 0.65, rough: 0.4, env: 1.0 });
  const bells = [];
  for (let row = 0; row < 3; row++) {
    for (let i = 0; i < 7 - row; i++) {
      const off = (i - (6 - row) / 2) * 3.4;
      const depth = 14 + row * 4;
      const wx = Math.cos(rot) * off + Math.sin(rot) * depth;
      const wz = -Math.sin(rot) * off + Math.cos(rot) * depth;
      const s = 1.5 - row * 0.22;
      bells.push({ x: x + wx, z: z + wz, y: ground + 2.2, w: s * 2, h: s * 2.6, d: s * 1.4 });
    }
  }
  const bellMesh = instancedBoxes(bells, bronze, { uvU: 4, uvV: 4 });
  if (bellMesh) g.add(bellMesh);
}

/* ==================== 8. 楚河汉街 ==================== */
function mkHanjie(g, x, z, ground, rot) {
  const rand = makeRandom(2026);
  const brick = mat('#a45c48', { rough: 0.9 });
  const stone = mat('#cfc4ac', { rough: 0.9 });
  const trim = mat('#efe8d8', { rough: 0.85 });
  const len = 1500;
  // 沿楚河南岸一排民国街屋
  const items = [];
  for (let d = -len / 2; d < len / 2; d += 34) {
    const jit = (rand() - 0.5) * 8;
    const h = 10 + rand() * 10;
    const wx = Math.cos(rot) * (d + jit), wz = -Math.sin(rot) * (d + jit);
    const px = x + wx + Math.sin(rot) * -34;      // 南岸(楚河以南)
    const pz = z + wz + Math.cos(rot) * -34;
    items.push({ x: px, z: pz, y: ground, w: 26, h, d: 20, rot: rot + (rand() - 0.5) * 0.05, tint: rand() > 0.5 ? '#a45c48' : '#cfc4ac' });
  }
  const row = instancedBoxes(items, mat('#ffffff', { rough: 0.9 }), { uvU: 26, uvV: 14 });
  if (row) g.add(row);
  // 汉街牌坊(两端)
  const gold = mat('#c9a227', { metal: 0.5, rough: 0.4 });
  for (const side of [-1, 1]) {
    const wx = Math.cos(rot) * (len / 2 * side), wz = -Math.sin(rot) * (len / 2 * side);
    const gx = x + wx + Math.sin(rot) * -20, gz = z + wz + Math.cos(rot) * -20;
    for (const o of [-9, 9]) {
      put(g, UNIT.cyl, mat('#9a3324'), {
        pos: [gx + Math.cos(rot) * o, ground, gz - Math.sin(rot) * o], scale: [1.4, 13, 1.4],
      });
    }
    put(g, UNIT.box, gold, { pos: [gx, ground + 12, gz], scale: [24, 1.6, 1.8], rot });
    put(g, UNIT.box, gold, { pos: [gx, ground + 15, gz], scale: [18, 2.4, 2], rot });
  }
}

/* ==================== 9. 汉秀剧场(红灯笼) ==================== */
function mkLantern(g, x, z, ground) {
  const red = mat('#b02a20', { rough: 0.55, emissive: '#7a1408', emissiveIntensity: 0 });
  red.userData.nightGlow = 2.2;
  const gold = mat('#c9a227', { metal: 0.7, rough: 0.3, env: 1.2 });
  // 基座
  put(g, UNIT.cyl, mat('#8d9095', { rough: 0.8 }), { pos: [x, ground, z], scale: [96, 6, 96] });
  // 灯笼主体(球)
  const R = 45;
  const ball = put(g, UNIT.sphere, red, { pos: [x, ground + 6 + R, z], scale: [R * 2, R * 1.7, R * 2] });
  ball.castShadow = true;
  // 竖向骨架(灯笼骨;UNIT.box 底原点,注意从球心向下半高起算)
  const ribMat = mat('#8f1e14', { rough: 0.6 });
  for (let i = 0; i < 16; i++) {
    const a = (i / 16) * Math.PI * 2;
    put(g, UNIT.box, ribMat, {
      pos: [x + Math.cos(a) * R * 0.99, ground + 6 + R - R * 0.86, z + Math.sin(a) * R * 0.99],
      scale: [1.4, R * 1.72, 2.4], rot: -a,
    });
  }
  // 上下金色箍
  for (const dy of [R * 0.85, -R * 0.85]) {
    put(g, UNIT.cyl, gold, { pos: [x, ground + 6 + R + dy, z], scale: [R * 1.45, 2.6, R * 1.45] });
  }
}

/* ==================== 10. 武汉绿地中心(475 m) ==================== */
function mkGreenland(g, x, z, ground, rot) {
  // 三瓣流线:旋转收分的 Lathe 塔身 + 塔冠
  const profile = [];
  const P = [[0, 31], [40, 30], [90, 28], [140, 26], [190, 23.5], [240, 21], [290, 18], [340, 14.5], [380, 11.5], [410, 9], [430, 6.5], [448, 3.4], [460, 1.2], [466, 0]];
  for (const [y, r] of P) profile.push(new THREE.Vector2(r, y));
  const geo = new THREE.LatheGeometry(profile, 28);
  const glass = mat('#a9c6d4', { rough: 0.18, metal: 0.6, env: 1.35 });
  const mesh = new THREE.Mesh(geo, glass);
  mesh.position.set(x, ground, z);
  mesh.rotation.y = rot;
  mesh.castShadow = true;
  mesh.userData.nightGlow = 0;
  g.add(mesh);
  // 塔冠天线
  put(g, UNIT.cyl, mat('#8d949a', { metal: 0.6, rough: 0.3 }), { pos: [x, ground + 466, z], scale: [1.6, 10, 1.6] });
  // 裙房
  put(g, UNIT.box, mat('#b9c4c9', { rough: 0.4, metal: 0.3 }), { pos: [x, ground, z], scale: [110, 18, 90], rot });
}

/* ==================== 11. 武汉大学(老斋舍 + 樱顶老图书馆) ==================== */
function mkWhu(g, x, z, ground, rot) {
  const wall = mat('#c9bda8', { rough: 0.9 });
  const roofGreen = mat('#2f5a45', { rough: 0.65, env: 0.5 });
  // 依山而上的三进老斋舍(台阶两侧)
  const stepD = 60;
  for (let i = 0; i < 3; i++) {
    const gy = terrainHeight(x + Math.sin(rot) * (-stepD * i), z + Math.cos(rot) * (-stepD * i));
    for (const side of [-1, 1]) {
      const ox = Math.cos(rot) * 21 * side, oz = -Math.sin(rot) * 21 * side;
      const bx = x + Math.sin(rot) * (-stepD * i) + ox;
      const bz = z + Math.cos(rot) * (-stepD * i) + oz;
      put(g, UNIT.box, wall, { pos: [bx, gy, bz], scale: [16, 11, 46], rot });
      put(g, UNIT.box, roofGreen, { pos: [bx, gy + 11.6, bz], scale: [18, 1.6, 48], rot });
    }
  }
  // 百级台阶
  const steps = [];
  for (let i = 0; i < 30; i++) {
    const gy = terrainHeight(x + Math.sin(rot) * (-stepD * i / 29 * 2), z + Math.cos(rot) * (-stepD * i / 29 * 2));
    steps.push({ x: x + Math.sin(rot) * (-stepD * i / 29 * 2), z: z + Math.cos(rot) * (-stepD * i / 29 * 2), y: gy, w: 14, h: 1.2, d: 3.4, rot });
  }
  const sm = instancedBoxes(steps, mat('#b8b2a2', { rough: 0.95 }), { uvU: 8, uvV: 3 });
  if (sm) g.add(sm);
  // 樱顶老图书馆(山顶,绿瓦四方攒尖)
  const topY = Math.max(terrainHeight(x + Math.sin(rot) * (-stepD * 2.2), z + Math.cos(rot) * (-stepD * 2.2)), ground + 12);
  const libX = x + Math.sin(rot) * (-stepD * 2.2);
  const libZ = z + Math.cos(rot) * (-stepD * 2.2);
  const lib = chineseHall({
    w: 22, d: 22, pedestalH: 4, bodyH: 9, roofRise: 8,
    roofType: 'hip', ridgeLen: 8, finial: true,
    stoneColor: '#cfc9b8', postColor: '#8e2f22', wallColor: '#c9bda8',
    roofColor: '#2f5a45', ridgeColor: '#24453a',
    bays: 5, dougongTier: 2, segX: 12, segZ: 12,
  });
  lib.position.set(libX, topY, libZ);
  lib.rotation.y = rot;
  g.add(lib);
}

/* ==================== 12. 磨山楚天台 ==================== */
function mkChutiantai(g, x, z, ground, rot) {
  // 高台 + 三层楼阁
  const plat = pedestal(38, 30, 8, '#b8b2a2');
  plat.position.set(x, ground, z);
  g.add(plat);
  const pav = storiedPavilion({
    floors: [{ w: 24, d: 17, h: 7 }, { w: 20, d: 14, h: 6 }, { w: 16, d: 11, h: 5.5 }],
    eaveW: 28,
    topRoof: 9.5,
    topType: 'jian',
    finial: true,
    postColor: '#8e2f22',
    wallColor: '#e0d6c2',
    roofColor: '#3d5a45',
    stoneColor: '#b8b2a2',
    bays: 5,
  });
  pav.position.set(x, ground + 8, z);
  g.add(pav);
}

/* ==================== 13. 光谷广场·星河 ==================== */
function mkXinghe(g, x, z, ground) {
  const silver = mat('#c8ccd4', { metal: 0.85, rough: 0.25, env: 1.5 });
  // 数条空间曲线拱(星河漩涡)
  const rand = makeRandom(77);
  for (let i = 0; i < 6; i++) {
    const h = 16 + rand() * 19;
    const span = 60 + rand() * 70;
    const a = rand() * Math.PI * 2;
    const pts = [];
    for (let k = 0; k <= 20; k++) {
      const t = k / 20 - 0.5;
      pts.push(new THREE.Vector3(
        x + Math.cos(a) * span * t + Math.sin(a) * t * 18,
        ground + Math.cos(t * Math.PI) * h,
        z - Math.sin(a) * span * t + Math.cos(a) * t * 18,
      ));
    }
    const curve = new THREE.CatmullRomCurve3(pts);
    const tube = new THREE.Mesh(new THREE.TubeGeometry(curve, 40, 0.55 + rand() * 0.5, 6, false), silver);
    tube.castShadow = true;
    g.add(tube);
  }
  // 环岛转盘(大圆盘下沉广场)
  put(g, UNIT.cyl, mat('#8d9095', { rough: 0.9 }), { pos: [x, ground + 0.4, z], scale: [190, 0.8, 190] });
}

/* ==================== 14. 归元寺 ==================== */
function mkGuiyuan(g, x, z, ground, rot) {
  // 大雄宝殿(歇山)
  const hall = chineseHall({
    w: 26, d: 18, pedestalH: 2.4, bodyH: 8.5, roofRise: 6,
    roofType: 'gable-hip',
    stoneColor: '#cfc9b8', postColor: '#8e2f22', wallColor: '#d8cdb8',
    roofColor: '#3a4045', ridgeColor: '#2c3430',
    bays: 5, dougongTier: 2,
  });
  hall.position.set(x + Math.sin(rot) * 60, Math.max(terrainHeight(x + Math.sin(rot) * 60, z + Math.cos(rot) * 60), 0), z + Math.cos(rot) * 60);
  hall.rotation.y = rot + Math.PI / 2;
  g.add(hall);
  // 藏经阁(双檐两层)
  const pav = storiedPavilion({
    floors: [{ w: 16, d: 12, h: 5.5 }, { w: 13, d: 10, h: 4.5 }],
    eaveW: 19, topRoof: 5, topType: 'gable-hip',
    postColor: '#8e2f22', wallColor: '#d8cdb8', roofColor: '#3a4045', stoneColor: '#cfc9b8', bays: 5,
  });
  pav.position.set(x - Math.sin(rot) * 40, Math.max(terrainHeight(x - Math.sin(rot) * 40, z - Math.cos(rot) * 40), 0), z - Math.cos(rot) * 40);
  pav.rotation.y = rot + Math.PI / 2;
  g.add(pav);
  // 罗汉堂(长堂)
  put(g, UNIT.box, mat('#c9bda8', { rough: 0.9 }), {
    pos: [x + Math.sin(rot + Math.PI / 2) * 70, ground, z + Math.cos(rot + Math.PI / 2) * 70],
    scale: [14, 8, 40], rot: rot + Math.PI / 2,
  });
  const roofR = gableRoof({ w: 16, d: 44, rise: 3.4, color: '#3a4045' });
  roofR.position.set(x + Math.sin(rot + Math.PI / 2) * 70, ground + 8, z + Math.cos(rot + Math.PI / 2) * 70);
  roofR.rotation.y = rot + Math.PI / 2;
  g.add(roofR);
  // 山门 + 围墙
  const gate = chineseHall({
    w: 12, d: 6, pedestalH: 1, bodyH: 5, roofRise: 3.2,
    roofType: 'gable', stoneColor: '#cfc9b8', postColor: '#8e2f22', wallColor: '#d8cdb8',
    roofColor: '#3a4045', bays: 3, dougongTier: 1, rails: false,
  });
  gate.position.set(x, ground, z);
  gate.rotation.y = rot + Math.PI / 2;
  g.add(gate);
  const wallMat = mat('#c9a06a', { rough: 0.95 });
  put(g, UNIT.box, wallMat, { pos: [x + Math.sin(rot + Math.PI / 2) * 110, ground + 1.6, z], scale: [220, 3.2, 0.8], rot });
  put(g, UNIT.box, wallMat, { pos: [x - Math.sin(rot + Math.PI / 2) * 110, ground + 1.6, z], scale: [220, 3.2, 0.8], rot });
}

/* ==================== 15. 古琴台 ==================== */
function mkGuqintai(g, x, z, ground, rot) {
  // 六角亭(知音亭)
  const plat = pedestal(18, 14, 1.6, '#cfc9b8');
  plat.position.set(x, ground, z);
  g.add(plat);
  const hex = new THREE.Group();
  const colMat = mat('#8e2f22', { rough: 0.8 });
  for (let i = 0; i < 6; i++) {
    const a = (i / 6) * Math.PI * 2;
    put(hex, UNIT.cyl, colMat, { pos: [Math.cos(a) * 4.4, 1.6, Math.sin(a) * 4.4], scale: [0.7, 4.6, 0.7] });
  }
  const roofGeo = new THREE.ConeGeometry(6.8, 3.2, 6);
  const roof = new THREE.Mesh(roofGeo, mat('#3a4045', { rough: 0.7 }));
  roof.position.y = 8.2;
  roof.castShadow = true;
  hex.add(roof);
  put(hex, UNIT.sphere, mat('#c9a227', { metal: 0.6 }), { pos: [0, 9.9, 0], scale: [1.2, 1.2, 1.2] });
  hex.position.set(x, ground, z);
  g.add(hex);
  // 琴台(石案)
  put(g, UNIT.box, mat('#b8b2a2', { rough: 0.95 }), { pos: [x + 10, ground + 1.8, z], scale: [3, 0.6, 1.2], rot });
  // 碑廊
  put(g, UNIT.box, mat('#c9a06a', { rough: 0.95 }), { pos: [x - 14, ground + 1.4, z + 8], scale: [24, 2.8, 0.6], rot: rot + 0.4 });
  put(g, UNIT.box, mat('#c9a06a', { rough: 0.95 }), { pos: [x - 14, ground + 1.4, z - 8], scale: [24, 2.8, 0.6], rot: rot + 0.4 });
}

/* ==================== 16. 昙华林(教堂 + 老宅) ==================== */
function mkTanhualin(g, x, z, ground, rot) {
  const rand = makeRandom(1861);
  // 教堂(罗马式:巴西利卡 + 钟塔)
  const church = new THREE.Group();
  const cw = mat('#d8d0be', { rough: 0.9 });
  put(church, UNIT.box, cw, { pos: [0, 0, 0], scale: [10, 9, 22] });
  const roofC = gableRoof({ w: 12, d: 24, rise: 3.6, color: '#5a5248' });
  roofC.position.y = 9;
  church.add(roofC);
  put(church, UNIT.box, cw, { pos: [0, 0, 13], scale: [7, 15, 7] });
  put(church, UNIT.cone4, mat('#4a4440'), { pos: [0, 17.5, 13], scale: [8, 7, 8], rot: Math.PI / 4 });
  put(church, UNIT.box, mat('#5a5248'), { pos: [0, 22.4, 13], scale: [0.5, 2.5, 0.5] });
  church.position.set(x, ground, z);
  church.rotation.y = rot;
  g.add(church);
  // 老宅街屋(青砖 + 红砖混合)
  const items = [];
  for (let i = 0; i < 14; i++) {
    const d = (i - 6.5) * 42;
    const side = i % 2 ? 1 : -1;
    const px = x + Math.cos(rot) * d + Math.sin(rot) * side * 26;
    const pz = z - Math.sin(rot) * d + Math.cos(rot) * side * 26;
    items.push({
      x: px, z: pz, y: Math.max(terrainHeight(px, pz), 0), w: 18, h: 6 + rand() * 5, d: 14,
      rot: rot + (rand() - 0.5) * 0.1,
      tint: ['#7a6a58', '#a45c48', '#c9bda8', '#8a8070'][(rand() * 4) | 0],
    });
  }
  const houses = instancedBoxes(items, mat('#ffffff', { rough: 0.95 }), { uvU: 18, uvV: 8 });
  if (houses) g.add(houses);
}

/* ==================== 17. 辛亥革命红楼 ==================== */
function mkHonglou(g, x, z, ground, rot) {
  const red = mat('#9a3b2c', { rough: 0.9 });
  // 主楼两层 + 门廊柱式 + 红瓦四坡顶
  put(g, UNIT.box, red, { pos: [x, ground, z], scale: [40, 11, 16], rot });
  const roof = hipRoof({ w: 44, d: 20, rise: 4.2, ridgeLen: 18, color: '#7a3020', ridge: true, segX: 12, segZ: 10 });
  roof.position.set(x, ground + 11, z);
  roof.rotation.y = rot;
  g.add(roof);
  // 门廊(8 柱)
  const cols = [];
  for (let i = 0; i < 8; i++) {
    const off = -14 + i * 4;
    cols.push({
      x: x + Math.cos(rot) * off + Math.sin(rot) * 9,
      z: z - Math.sin(rot) * off + Math.cos(rot) * 9,
      y: ground - 0.4, w: 1.4, h: 10.4, d: 1.4,
    });
  }
  const cm = instancedBoxes(cols, mat('#d8d2c0', { rough: 0.8 }), { uvU: 4, uvV: 10 });
  if (cm) g.add(cm);
  put(g, UNIT.box, mat('#8a3526'), {
    pos: [x + Math.sin(rot) * 9, ground + 10, z + Math.cos(rot) * 9], scale: [32, 1.4, 5], rot,
  });
  // 两侧翼楼
  for (const side of [-1, 1]) {
    put(g, UNIT.box, red, {
      pos: [x + Math.cos(rot) * 34 * side, ground, z - Math.sin(rot) * 34 * side], scale: [24, 9, 13], rot,
    });
  }
}

/* ==================== 汇总 ==================== */
const BUILDERS = {
  huanghelou: mkHuangelou,
  tvtower: mkTvtower,
  qingchuan: mkQingchuan,
  jianghanguan: mkJianghanguan,
  street: mkJianghanlu,
  jiangtan: mkJiangtan,
  museum: mkMuseum,
  hanjie: mkHanjie,
  lantern: mkLantern,
  supertall: mkGreenland,
  whu: mkWhu,
  chutiantai: mkChutiantai,
  xinghe: mkXinghe,
  guiyuan: mkGuiyuan,
  guqintai: mkGuqintai,
  tanhualin: mkTanhualin,
  honglou: mkHonglou,
};

export function buildLandmarks() {
  const group = new THREE.Group();
  group.name = 'landmarks';
  for (const lm of LANDMARKS) {
    const fn = BUILDERS[lm.model];
    if (!fn) continue;
    const [x, z] = toV2(lm.lon, lm.lat);
    const ground = groundAt(x, z);
    const rot = lm.params?.rot != null ? bearingToRot(lm.params.rot) : 0;
    const sub = new THREE.Group();
    sub.name = 'lm:' + lm.id;
    sub.userData.lm = lm;
    fn(sub, x, z, ground, rot);
    group.add(sub);
  }
  return {
    group,
    setNight(nk) {
      // userData.nightGlow 标记的材质随夜色点亮(黄鹤楼金顶/汉秀红灯笼/江汉关钟面)
      group.traverse((o) => {
        if (o.isMesh && o.material?.emissive && o.material.userData && 'nightGlow' in o.material.userData) {
          o.material.emissiveIntensity = o.material.userData.nightGlow * nk;
        }
      });
    },
  };
}

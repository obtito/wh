// 冒烟测试:投影真值、数据完整性、水域/道路几何关系(node 直接跑,不依赖 three/DOM)
// 用法: node tools/smoke.mjs
import { gaussForward, toV2, toV2List, pointInPolygon, distToPolyline } from '../js/geo.js';
import { RIVER, LAKES, MOUNTAINS, ROADS, BRIDGES, LANDMARKS, DISTRICTS, TOUR, CATEGORIES } from '../js/data.js';

let pass = 0, fail = 0;
function ok(cond, msg, detail = '') {
  if (cond) { pass++; console.log(`  ✓ ${msg}`); }
  else { fail++; console.error(`  ✗ ${msg} ${detail}`); }
}

console.log('== 1. 高斯投影真值(与等距圆柱独立口径比对) ==');
{
  // 原点附近 1° 经差在 30.56°N ≈ 95.75 km(独立公式 111.32·cos(30.56°))
  const [e1] = gaussForward(115.295, 30.56);
  const [e0] = gaussForward(114.295, 30.56);
  const kmPerDegLon = (e1 - e0) / 1000;
  const expect = 111.32 * Math.cos(30.56 * Math.PI / 180);
  ok(Math.abs(kmPerDegLon - expect) / expect < 0.003, `东西向每度 ≈ ${expect.toFixed(2)} km`, `实测 ${kmPerDegLon.toFixed(2)}`);
  const [, n1] = gaussForward(114.295, 31.56);
  const [, n0] = gaussForward(114.295, 30.56);
  const kmPerDegLat = (n1 - n0) / 1000;
  ok(kmPerDegLat > 110 && kmPerDegLat < 112, `南北向每度 ≈ 110.9 km`, `实测 ${kmPerDegLat.toFixed(2)}`);

  // 已知点对距离:黄鹤楼 → 江汉关直线约 4.1 km
  const [hx, hz] = toV2(114.3011, 30.5433);
  const [jx, jz] = toV2(114.2838, 30.5768);
  const d = Math.hypot(jx - hx, jz - hz);
  ok(d > 3600 && d < 4500, `黄鹤楼→江汉关 直线距离 ${Math.round(d)} m(约测 4.1 km)`);
}

console.log('== 2. 两江交汇几何 ==');
{
  const mainPts = toV2List(RIVER.pts);
  const han = toV2List(RIVER.branches[0].pts);
  // 汉江末端应贴近长江
  const hanEnd = han[han.length - 1];
  const dEnd = distToPolyline(hanEnd[0], hanEnd[1], mainPts);
  ok(dEnd < RIVER.halfWidth, `汉江入汇口落在长江水面内(距江心线 ${Math.round(dEnd)} m)`);
  // 交汇点应在场景中段(离原点 < 6 km)
  ok(Math.hypot(hanEnd[0], hanEnd[1]) < 6000, `两江交汇口距原点 ${Math.round(Math.hypot(hanEnd[0], hanEnd[1]))} m`);
}

console.log('== 3. 地标数据完整性 ==');
{
  const catKeys = new Set(CATEGORIES.map((c) => c.key));
  for (const lm of LANDMARKS) {
    ok(!!lm.id && !!lm.name && !!lm.model, `地标 ${lm.name || lm.id} 字段完整`);
    ok(catKeys.has(lm.cat), `地标 ${lm.name} 分类 ${lm.cat} 有效`);
    ok(typeof lm.heightM === 'number' && lm.heightM > 0 && lm.heightM < 600, `地标 ${lm.name} heightM=${lm.heightM} 合理`);
  }
  for (const br of BRIDGES) {
    const [ax, az] = toV2(...br.axis[0]);
    const [bx, bz] = toV2(...br.axis[1]);
    const len = Math.hypot(bx - ax, bz - az);
    ok(len > 100, `桥 ${br.name} 跨度 ${Math.round(len)} m > 100 m`);
    ok(Math.abs(len - br.totalM) / br.totalM < 0.45, `桥 ${br.name} 跨度与 totalM=${br.totalM} 偏差 < 45%`, `实测 ${Math.round(len)}`);
  }
}

console.log('== 4. 地标不落水 ==');
{
  const riverPts = toV2List(RIVER.pts);
  const hanPts = toV2List(RIVER.branches[0].pts);
  const lakePolys = LAKES.map((l) => toV2List(l.pts));
  for (const lm of LANDMARKS) {
    const [x, z] = toV2(lm.lon, lm.lat);
    // 陆地地标距江心线应 > 半宽一半(简化:江面外),且不在湖里
    const dMain = distToPolyline(x, z, riverPts);
    const dHan = distToPolyline(x, z, hanPts);
    const inLake = lakePolys.some((p) => pointInPolygon(x, z, p));
    const onWater = dMain < 600 || dHan < 150 || inLake;
    // 临江建筑例外:汉口江滩(滨江公园)与晴川阁(禹功矶,立在水线高台上)
    if (lm.id === 'hankoujiangtan') { ok(dMain < 900 && dMain > 300, `江滩贴岸(距江心 ${Math.round(dMain)} m)`); continue; }
    if (lm.id === 'qingchuan') { ok(dMain < 650 && dMain > 450, `晴川阁临江矶头(距江心 ${Math.round(dMain)} m)`); continue; }
    ok(!onWater, `地标 ${lm.name} 在陆地上(距长江 ${Math.round(dMain)} m,汉江 ${Math.round(dHan)} m,湖内=${inLake})`);
  }
}

console.log('== 5. 桥轴与江面相交 ==');
{
  const riverPts = toV2List(RIVER.pts);
  const hanPts = toV2List(RIVER.branches[0].pts);
  for (const br of BRIDGES) {
    const isHan = ['jianghanbridge', 'qingchuanbridge'].includes(br.id);
    const pts = isHan ? hanPts : riverPts;
    const midLon = (br.axis[0][0] + br.axis[1][0]) / 2;
    const midLat = (br.axis[0][1] + br.axis[1][1]) / 2;
    const [mx, mz] = toV2(midLon, midLat);
    const d = distToPolyline(mx, mz, pts);
    const hw = isHan ? RIVER.branches[0].halfWidth : 700;
    ok(d < hw, `桥 ${br.name} 跨越水面(桥中点距江心线 ${Math.round(d)} m < ${hw} m)`);
  }
}

console.log('== 6. 道路网完整性 ==');
{
  let totalLen = 0;
  for (const r of ROADS) {
    ok(r.pts.length >= 2 && r.w > 0, `道路 ${r.name} 折线有效`);
    const pts = toV2List(r.pts);
    for (let i = 1; i < pts.length; i++) totalLen += Math.hypot(pts[i][0] - pts[i - 1][0], pts[i][1] - pts[i - 1][1]);
  }
  console.log(`  · 主干网总长 ${Math.round(totalLen / 1000)} km`);
  ok(totalLen > 80000, '主干网总长 > 80 km');
}

console.log('== 7. 山体与水系不冲突 ==');
{
  for (const m of MOUNTAINS) {
    ok(m.rx > 100 && m.rz > 100 && m.h > 20, `山 ${m.name} 尺度合理(${m.rx}×${m.rz} m, ${m.h} m)`);
  }
  // 蛇山(武昌)在龟山(汉阳)东南、隔江对峙:蛇山 x 更大(东)、z 更大(南)
  const [sx, sz] = toV2(114.30, 30.5425);
  const [gx, gz] = toV2(114.262, 30.552);
  ok(sx - gx > 2000, `蛇山在龟山以东(Δx=${Math.round(sx - gx)} m)`);
  ok(sz > gz, `蛇山在龟山以南(蛇z=${Math.round(sz)} > 龟z=${Math.round(gz)},z 正=南)`);
  // 两山隔长江对望,间距约 2.4 km
  const d = Math.hypot(sx - gx, sz - gz);
  ok(d > 1800 && d < 4500, `龟蛇锁大江:两山相距 ${Math.round(d)} m`);
}

console.log('== 8. 观光任务链 ==');
{
  const ids = new Set(LANDMARKS.map((l) => l.id), BRIDGES.map((b) => b.id));
  for (const b of BRIDGES) ids.add(b.id);
  for (const s of TOUR.steps) {
    ok(ids.has(s.poi), `任务步骤 ${s.poi} 存在于地标/桥清单`);
  }
}

console.log('== 9. 分区覆盖 ==');
{
  ok(DISTRICTS.length >= 10, `分区数 ${DISTRICTS.length} ≥ 10`);
  for (const d of DISTRICTS) {
    ok(d.poly.length >= 4 && d.hMax >= d.hMin, `分区 ${d.name} 参数合理`);
  }
}

console.log(`\n冒烟结果:${pass} 通过,${fail} 失败`);
process.exit(fail ? 1 : 0);

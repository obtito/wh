// 地标几何高度校验:node 里直接构建 three 几何,对照 data.js 实测 heightM
// 用法: node tools/heights.mjs
import * as THREE from '../vendor/three.module.js';
import { buildLandmarks } from '../js/landmarks.js';
import { buildBridges, bridgeHeightAt } from '../js/bridges.js';
import { toV2 } from '../js/geo.js';

let pass = 0, fail = 0;
const ok = (cond, msg) => { if (cond) { pass++; } else { fail++; console.error(`  ✗ ${msg}`); } };

const { group } = buildLandmarks();
const box = new THREE.Box3();

console.log('== 地标高度校验(模型总高 vs 实测 heightM,容差 ±25%) ==');
for (const sub of group.children) {
  const lm = sub.userData.lm;
  box.setFromObject(sub);
  const h = box.max.y - box.min.y;
  const ref = lm.heightM;
  const dev = Math.abs(h - ref) / ref;
  const mark = dev < 0.25 ? '✓' : '✗';
  if (dev < 0.25) pass++;
  else fail++;
  console.log(`  ${mark} ${lm.name.padEnd(10, '　')} 模型 ${h.toFixed(1).padStart(7)} m / 实测 ${ref} m  (偏差 ${(dev * 100).toFixed(0)}%)`);
}

console.log('== 桥面高程查询(bridgeHeightAt) ==');
{
  const { group: bg } = buildBridges();
  // 长江大桥跨中桥面应约 deckH
  const [mx, mz] = toV2(114.282787, 30.552201);
  const y = bridgeHeightAt(mx, mz);
  ok(y != null && y > 15 && y < 40, `长江大桥跨中桥面 y=${y?.toFixed(1)} m(期望 ~26)`);
  // 远离桥面应为 null
  const [ox, oz] = toV2(114.30, 30.5425);
  ok(bridgeHeightAt(ox, oz) === null, '黄鹤楼处无桥面覆盖');
}

console.log(`\n高度校验:${pass} 通过,${fail} 失败`);
process.exit(fail ? 1 : 0);

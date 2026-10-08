// 街道小品:KayKit City Builder Bits(CC0)沿路摆放
// 长椅/消防栓/垃圾桶/灌木/垃圾箱/纸箱 + 路口红绿灯(端点聚类) + 夜间灯罩发光
import * as THREE from 'three';
import { makeRandom } from './geo.js';
import { loadGLB } from './assets.js';
import { groundY } from './ground.js';

const PROPS = [
  { file: 'bench', spacing: 130, chance: 0.5, rot: 0 },          // 长椅(平行路)
  { file: 'firehydrant', spacing: 210, chance: 0.4, rot: 0 },    // 消防栓
  { file: 'trash_A', spacing: 170, chance: 0.45, rot: 0 },       // 垃圾桶
  { file: 'trash_B', spacing: 190, chance: 0.35, rot: 0 },       // 垃圾桶(方)
  { file: 'bush', spacing: 60, chance: 0.55, rot: 0 },           // 灌木(密)
  { file: 'dumpster', spacing: 380, chance: 0.3, rot: 0 },       // 垃圾箱
  { file: 'box_A', spacing: 300, chance: 0.22, rot: 0 },         // 纸箱堆(巷口)
  { file: 'box_B', spacing: 340, chance: 0.18, rot: 0 },         // 纸箱
];
// A 上游模型只是条纹杆无灯头,弃用;B=立杆横排三灯,C=弯臂悬挂式
const TRAFFIC_LIGHTS = ['trafficlight_B', 'trafficlight_C'];
const GLOW_PROPS = new Set(TRAFFIC_LIGHTS);   // 夜间灯罩发光(emissiveMap 复用漫反射)

/** 沿中心线网摆放(GLB 组合体 → 有限数量独立摆放,红绿灯单独走路口逻辑) */
export async function buildStreetProps(centerlines, budget = 320) {
  const group = new THREE.Group();
  group.name = 'street-props';
  const rand = makeRandom(8811);
  const lines = centerlines.filter((l) => l.pts && l.pts.length >= 2 && l.w >= 16);
  if (!lines.length) return { group, count: 0, setNight: () => {} };

  // 每类小品加载一次模板
  const templates = {};
  for (const p of [...PROPS.map((x) => x.file), ...TRAFFIC_LIGHTS]) {
    const g = await loadGLB(`./assets/props/${p}.gltf`);
    if (g) templates[p] = g;
  }
  const files = Object.keys(templates);
  if (!files.length) return { group, count: 0, setNight: () => {} };

  // 夜间发光材质(红绿灯透镜:贴图亮部发光,深色杆不亮)
  const glowMats = [];
  for (const f of GLOW_PROPS) {
    if (!templates[f]) continue;
    templates[f].traverse((o) => {
      if (o.isMesh && o.material && o.material.isMeshStandardMaterial) {
        const m = o.material;
        m.emissive = new THREE.Color('#ffd9a0');
        m.emissiveMap = m.map;
        m.emissiveIntensity = 0;
        glowMats.push(m);
      }
    });
  }
  const setNight = (k) => { for (const m of glowMats) m.emissiveIntensity = k * 0.85; };

  const placeAt = (tpl, x, z, y, rotY) => {
    const g = tpl.clone(true);
    const box = tpl.userData.box || (tpl.userData.box = new THREE.Box3().setFromObject(tpl));
    g.position.set(x, y - box.min.y, z);
    g.rotation.y = rotY;
    g.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = true; } });
    group.add(g);
  };

  // ---- 红绿灯:路口 = 多条中心线的端点在 14m 内相聚 ----
  let tlCount = 0;
  {
    const ends = [];   // {x,z,line}
    for (const l of lines) {
      ends.push({ x: l.pts[0][0], z: l.pts[0][1], line: l });
      const q = l.pts[l.pts.length - 1];
      ends.push({ x: q[0], z: q[1], line: l });
    }
    const nodes = [];  // {x,z,lines:Set}
    for (const e of ends) {
      let node = null;
      for (const nd of nodes) {
        if (Math.hypot(nd.x - e.x, nd.z - e.z) < 14) { node = nd; break; }
      }
      if (node) { node.x = (node.x * node.n + e.x) / (node.n + 1); node.z = (node.z * node.n + e.z) / (node.n + 1); node.n++; node.lines.add(e.line); }
      else nodes.push({ x: e.x, z: e.z, n: 1, lines: new Set([e.line]) });
    }
    const cross = nodes.filter((nd) => nd.lines.size >= 2).slice(0, 160);
    let k = 0;
    for (const nd of cross) {
      const key = TRAFFIC_LIGHTS[k % TRAFFIC_LIGHTS.length];
      const tpl = templates[key];
      k++;
      if (!tpl) break;
      // 取该路口最宽的路做贴角朝向
      let ref = null;
      for (const l of nd.lines) if (!ref || l.w > ref.w) ref = l;
      const p0 = ref.pts[0], p1 = ref.pts[1];
      const dx = p1[0] - p0[0], dz = p1[1] - p0[1], len = Math.hypot(dx, dz) || 1;
      const side = rand() > 0.5 ? 1 : -1;
      const off = (ref.w / 2 + 1.3) * side;
      const x = nd.x + (-dz / len) * off, z = nd.z + (dx / len) * off;
      placeAt(tpl, x, z, groundY(x, z), Math.atan2(dx, dz) + (side > 0 ? Math.PI : 0));
      tlCount++;
    }
  }

  // ---- 常规小品:按 spacing 沿线取样,路缘外 1.2m,交替两侧 ----
  let count = tlCount;
  for (const p of PROPS) {
    const tpl = templates[p.file];
    if (!tpl || count >= budget) continue;
    for (const line of lines) {
      let acc = rand() * p.spacing;
      for (let i = 1; i < line.pts.length && count < budget; i++) {
        const [ax, az] = line.pts[i - 1], [bx, bz] = line.pts[i];
        const segLen = Math.hypot(bx - ax, bz - az);
        while (acc + p.spacing <= segLen && count < budget) {
          acc += p.spacing;
          if (rand() > p.chance) continue;
          const t = acc / segLen;
          const dx = (bx - ax) / segLen, dz = (bz - az) / segLen;
          const side = rand() > 0.5 ? 1 : -1;
          const off = (line.w / 2 + 1.4) * side;
          const x = ax + (bx - ax) * t - dz * off;
          const z = az + (bz - az) * t + dx * off;
          const y0 = (line.ys ? lerpN(line.ys[i - 1], line.ys[i], t) : groundY(x, z));
          placeAt(tpl, x, z, y0, Math.atan2(dx, dz) + (rand() - 0.5) * 0.6 + (rand() > 0.5 ? Math.PI : 0));
          count++;
        }
        acc -= segLen;
      }
    }
  }
  return { group, count, traffic: tlCount, setNight };
}

const lerpN = (a, b, t) => a + (b - a) * t;

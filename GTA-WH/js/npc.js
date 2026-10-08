// 行人 NPC:KayKit 角色包(CC0)骨骼动画 + 沿真实路网行走
import * as THREE from 'three';
import { toV2, makeRandom } from './geo.js';
import { loadGLB } from './assets.js';
import { groundY } from './ground.js';

const CHARS = ['./assets/npc/Barbarian.glb', './assets/npc/Knight.glb', './assets/npc/Mage.glb', './assets/npc/Rogue.glb', './assets/npc/Druid.glb'];
// KayKit 2.0:动画独立成包(Rig_Medium 骨架通用)
const ANIM_PACKS = ['./assets/npc/anims/Rig_Medium_General.glb', './assets/npc/anims/Rig_Medium_MovementBasic.glb'];

/**
 * @param centerlines OSM 路网中心线(含 ys 路面高度)
 * @param count NPC 数量
 */
export async function buildNPCs(centerlines, count = 60) {
  const group = new THREE.Group();
  group.name = 'npcs';
  const rand = makeRandom(1717);

  // 加载角色(克隆骨架需 SkeletonUtils —— three r160 在 examples/utils/SkeletonUtils.js,vendor 没有:
  // 变通:每个 NPC 独立 loadGLB(loadGLB 内部 clone(true),骨架 clone 需要专门处理,
  // 因此这里直接多次 loadAsync 同一文件——loader 有缓存走浏览器 HTTP cache,成本可接受)
  const loaded = [];
  for (const url of CHARS) {
    try {
      const g = await loadGLB(url);
      if (g) loaded.push({ url, anims: null });
    } catch {}
  }
  if (!loaded.length) return { group, update: () => {}, count: 0 };

  // 路段采样:NPC 绑定到随机中心线,沿其往返
  const lines = centerlines.filter((l) => l.pts && l.pts.length >= 2 && l.w >= 16);
  if (!lines.length) return { group, update: () => {}, count: 0 };

  const npcs = [];
  const mixers = [];
  for (let i = 0; i < count; i++) {
    const url = loaded[i % loaded.length].url;
    const root = await loadGLB(url);          // 独立实例(骨架安全)
    if (!root) continue;
    const li = (rand() * lines.length) | 0;
    const line = lines[li];
    // 中心线累计长度
    const lens = [];
    let total = 0;
    for (let k = 1; k < line.pts.length; k++) {
      const d = Math.hypot(line.pts[k][0] - line.pts[k - 1][0], line.pts[k][1] - line.pts[k - 1][1]);
      lens.push(d); total += d;
    }
    const npc = {
      root, line, lens, total,
      s: rand() * total,                       // 沿线位置(米)
      dir: rand() > 0.5 ? 1 : -1,
      speed: 1.1 + rand() * 0.7,
      side: (rand() > 0.5 ? 1 : -1) * (line.w / 2 + 2.5),
      standing: rand() < 0.18,                 // 18% 站街
      phase: rand() * 10,
    };
    // 尺寸归一(KayKit 角色约 1.8m,已接近真实;仅微调)
    root.scale.setScalar(1.0);
    // 动画
    root.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.frustumCulled = false; } });
    group.add(root);
    npcs.push(npc);
  }

  // 动画剪辑:从独立动画包取(KayKit 2.0 动画与角色分离,Rig_Medium 骨架互通)
  let clips = [];
  try {
    const { GLTFLoader } = await import('three/addons/GLTFLoader.js');
    const loader = new GLTFLoader();
    for (const url of ANIM_PACKS) {
      const g = await loader.loadAsync(url);
      clips.push(...(g.animations || []));
    }
  } catch (e) { console.warn('[GTA-WH] 动画包加载失败:', e.message); }

  const actions = new Map();
  for (const npc of npcs) {
    const mixer = new THREE.AnimationMixer(npc.root);
    const clip = clips.length ? (npc.standing
      ? (clips.find((c) => /idle/i.test(c.name)) || clips[0])
      : (clips.find((c) => /walk/i.test(c.name)) || clips[0])) : null;
    if (clip) {
      const a = mixer.clipAction(clip);
      a.play();
      a.time = npc.phase % clip.duration;      // 相位错开
    }
    mixers.push(mixer);
  }

  const _v = new THREE.Vector3();
  function update(dt) {
    for (let i = 0; i < npcs.length; i++) {
      const n = npcs[i];
      if (!n.standing) {
        n.s += n.dir * n.speed * dt;
        if (n.s > n.total) { n.s = n.total; n.dir = -1; }
        if (n.s < 0) { n.s = 0; n.dir = 1; }
      }
      // 沿线插值位置 + 侧偏
      let target = n.s, seg = 0;
      for (let k = 0; k < n.lens.length; k++) {
        if (target <= n.lens[k] || k === n.lens.length - 1) { seg = k; break; }
        target -= n.lens[k];
      }
      const [ax, az] = n.line.pts[seg], [bx, bz] = n.line.pts[seg + 1];
      const dx = bx - ax, dz = bz - az, len = Math.hypot(dx, dz) || 1;
      const f = Math.min(1, target / n.lens[seg]);
      const px = ax + dx * f + (-dz / len) * n.side;
      const pz = az + dz * f + (dx / len) * n.side;
      const py = n.line.ys ? n.line.ys[seg] : groundY(px, pz);
      n.root.position.set(px, py, pz);
      n.root.rotation.y = Math.atan2(dx * n.dir, dz * n.dir);
      mixers[i]?.update(dt);
    }
  }

  return { group, update, count: npcs.length };
}

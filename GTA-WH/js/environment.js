// 共享 HDR 环境(移植自 GTA-NJ environment.js,思路源自 GTA_SZ)
// 程序化天空(Preetham)→ PMREMGenerator 预过滤 → scene.environment
// 显示链路做 tone mapping;IBL 辐射保持线性 HDR,两者自动分离。
import * as THREE from 'three';
import { Sky } from 'three/addons/Sky.js';
import { sunState, lerp } from './geo.js';

const QUANT = 0.5;        // 环境按 0.5 小时量化缓存
const MAX_CACHE = 5;      // LRU 上限

export function createEnvironment(renderer) {
  const pmrem = new THREE.PMREMGenerator(renderer);
  pmrem.compileCubemapShader();

  const sky = new Sky();
  sky.scale.setScalar(60000);        // 主场景米制,包住远景
  sky.material.depthTest = false;
  sky.material.depthWrite = false;
  sky.material.toneMapped = false;
  sky.frustumCulled = false;
  const envScene = new THREE.Scene();
  envScene.add(sky);
  const u = sky.material.uniforms;

  const cache = new Map();
  let currentKey = null;
  let currentRT = null;
  let ready = false;

  function configure(hours) {
    const s = sunState(hours);
    u.sunPosition.value.set(s.dir.x, s.dir.y, s.dir.z);
    u.turbidity.value = lerp(3.2, 8.5, s.dusk);
    u.rayleigh.value = lerp(0.8, 2.4, s.dusk);
    u.mieCoefficient.value = 0.006;
    u.mieDirectionalG.value = 0.82;
    u.up.value.set(0, 1, 0);
    return s;
  }

  function evict() {
    while (cache.size > MAX_CACHE) {
      let oldestKey = null, oldestT = Infinity;
      for (const [k, v] of cache) if (v.t < oldestT) { oldestT = v.t; oldestKey = k; }
      const hit = cache.get(oldestKey);
      cache.delete(oldestKey);
      if (hit && hit.rt !== currentRT) hit.rt.dispose();
    }
  }

  function bake(hours) {
    const key = Math.round(hours / QUANT) * QUANT;
    const hit = cache.get(key);
    if (hit) { hit.t = performance.now(); return hit.rt.texture; }
    configure(key);
    const rt = pmrem.fromScene(envScene, 0, 1, 200000);
    cache.set(key, { rt, t: performance.now() });
    evict();
    return rt.texture;
  }

  function update(hours) {
    const key = Math.round(hours / QUANT) * QUANT;
    if (key === currentKey && currentRT) { cache.get(key).t = performance.now(); return currentRT.texture; }
    try {
      const tex = bake(hours);
      const hit = cache.get(key);
      if (hit) currentRT = hit.rt;
      currentKey = key;
      ready = true;
      return tex;
    } catch (e) {
      console.warn('[GTA-WH] 环境烘焙失败,回退为纯解析光照:', e);
      return null;
    }
  }

  function dispose() {
    for (const v of cache.values()) v.rt.dispose();
    cache.clear();
    currentRT = null; currentKey = null; ready = false;
    pmrem.dispose();
    sky.geometry.dispose();
    sky.material.dispose();
  }

  return {
    update, bake, dispose,
    isReady: () => ready,
    key: () => currentKey,
    size: () => cache.size,
  };
}

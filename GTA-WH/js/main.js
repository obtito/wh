// 武汉 · 江城 · 主程序
// 装配:世界(地形/水/路)+ 三镇城市 + 16 地标 + 5 桥 + 玩法(驾驶/步行/无人机)+ 昼夜 + HUD
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { Sky } from 'three/addons/Sky.js';
import { buildGround, buildMountains, createWaterMaterial, buildWater, buildRoads, terrainHeight } from './world.js';
import { buildCity, buildTrees, buildCars, buildStreetLights } from './city.js';
import { buildOsmCity, buildOsmRoads, OSM_BOX } from './city-osm.js';
import { buildLandmarks } from './landmarks.js';
import { buildBridges } from './bridges.js';
import { REAL_TOWERS, allExclusions } from './sites.js';
import { worldCollision } from './collision.js';
import { createEnvironment } from './environment.js';
import { initHUD } from './hud.js';
import { buildMetro, buildFerry } from './transit.js';
import { buildNPCs } from './npc.js';
import { buildStreetProps } from './props.js';
import { loadGLB } from './assets.js';
import { Game, MODE_NAME } from './game.js';
import { setEnvIntensity, mergeStaticMeshes } from './lib.js';
import { sunState, lerp, clamp, toV2, toLonLat } from './geo.js';
import { BRIDGES } from './data.js';

/* ==================== DOM ==================== */
const $ = (s) => document.querySelector(s);
const canvas = $('#scene');
const loadBar = $('#loadBar');
const loadText = $('#loadText');
const elFps = $('#fpsVal');
const elCoord = $('#coordVal');
const elSpeed = $('#speedVal');
const elSpeedBox = $('#speedBox');

/* ==================== 全局 ==================== */
let renderer, scene, camera, controls, sky, sunLight, hemi, moonLight, stars;
let waterMat, waterGroup, roads, city, trees, cars, bridges, landmarks, lights, beacon, metro, ferry, propsSys;
let osmCity = null, driveLines = null, npcs;
// OSM 覆盖区的场景坐标盒(供程序化城市避让)
const OSM_BOX_SCENE = (() => {
  const [x0, z0] = toV2(OSM_BOX.lon0, OSM_BOX.lat1);
  const [x1, z1] = toV2(OSM_BOX.lon1, OSM_BOX.lat0);
  return { minX: x0, maxX: x1, minZ: z0, maxZ: z1 };
})();
let game, hud;
let env = null;
let timeHours = 15, autoTime = false;
let nightK = 0;
const clock = new THREE.Clock();
const BUILD_STAMP = new Date().toISOString().slice(11, 19);
const BUILD_STEPS = [];

/* Sketchfab 真实地标楼群 / 地标占地圆 → js/sites.js(单一事实来源) */

/* ==================== 渲染器 / 场景 ==================== */
function initRenderer() {
  renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
  renderer.setPixelRatio(Math.min(devicePixelRatio, 1.75));
  renderer.setSize(window.innerWidth, window.innerHeight);
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 0.62;
  renderer.shadowMap.enabled = true;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  scene = new THREE.Scene();
  scene.fog = new THREE.Fog(0xc8d8e6, 1500, 16000);

  camera = new THREE.PerspectiveCamera(50, window.innerWidth / window.innerHeight, 1, 65000);
  // 开场镜头:两江交汇上空,望向长江大桥与黄鹤楼
  const [tx, tz] = toV2(114.2790, 30.5510);
  camera.position.set(tx - 700, 420, tz + 1050);
  controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = true;
  controls.dampingFactor = 0.07;
  controls.maxPolarAngle = Math.PI * 0.492;
  controls.minDistance = 8;
  controls.maxDistance = 24000;
  controls.target.set(tx, 30, tz);
  controls.update();

  sky = new Sky();
  sky.scale.setScalar(60000);
  const u = sky.material.uniforms;
  u.turbidity.value = 6;
  u.rayleigh.value = 1.4;
  u.mieCoefficient.value = 0.006;
  u.mieDirectionalG.value = 0.82;
  scene.add(sky);

  sunLight = new THREE.DirectionalLight(0xffffff, 2.6);
  sunLight.castShadow = true;
  sunLight.shadow.mapSize.set(2048, 2048);
  sunLight.shadow.camera.near = 10;
  sunLight.shadow.camera.far = 4600;
  sunLight.shadow.camera.left = -900;
  sunLight.shadow.camera.right = 900;
  sunLight.shadow.camera.top = 900;
  sunLight.shadow.camera.bottom = -900;
  sunLight.shadow.bias = -0.0004;
  scene.add(sunLight);
  scene.add(sunLight.target);

  hemi = new THREE.HemisphereLight(0xbfd4e8, 0x8a8a72, 0.55);
  scene.add(hemi);
  moonLight = new THREE.DirectionalLight(0x8fa8cc, 0);
  scene.add(moonLight);

  stars = (() => {
    const n = 1600;
    const pos = new Float32Array(n * 3);
    for (let i = 0; i < n; i++) {
      const v = new THREE.Vector3().randomDirection().multiplyScalar(42000);
      v.y = Math.abs(v.y) + 3000;
      pos.set([v.x, v.y, v.z], i * 3);
    }
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(pos, 3));
    const m = new THREE.PointsMaterial({ color: 0xcfd8ea, size: 42, sizeAttenuation: true, transparent: true, opacity: 0, fog: false, depthWrite: false });
    const p = new THREE.Points(g, m);
    p.frustumCulled = false;
    return p;
  })();
  scene.add(stars);

  window.addEventListener('resize', () => {
    camera.aspect = window.innerWidth / window.innerHeight;
    camera.updateProjectionMatrix();
    renderer.setSize(window.innerWidth, window.innerHeight);
  });
}

/* ==================== 昼夜 ==================== */
const FOG_DAY = new THREE.Color('#c8d8e6');
const FOG_NIGHT = new THREE.Color('#101826');
const lastSunDir = new THREE.Vector3(0.5, 0.8, 0.3);
const realTowerMats = [];          // Sketchfab 真楼的夜间亮化材质

function applyTime(hours) {
  const s = sunState(hours);
  const uSky = sky.material.uniforms;
  uSky.sunPosition.value.set(s.dir.x, s.dir.y, s.dir.z);
  uSky.turbidity.value = lerp(3.4, 8.5, s.dusk);
  uSky.rayleigh.value = lerp(0.8, 2.4, s.dusk);

  const focus = game?._pos ?? controls.target;
  sunLight.position.set(s.dir.x * 1800, s.dir.y * 1800, s.dir.z * 1800).add(focus);
  sunLight.target.position.copy(focus);
  sunLight.intensity = 2.6 * s.day + 0.15 * s.dusk;
  sunLight.color.setHSL(0.09 + 0.03 * s.day, lerp(0.62, 0.12, s.day), lerp(0.55, 1.0, s.day));

  hemi.intensity = lerp(0.08, 0.55, s.day) + 0.06 * s.dusk;
  moonLight.intensity = 0.22 * s.night;
  stars.material.opacity = clamp(s.night - 0.25, 0, 0.9);

  if (waterMat) {
    waterMat.uniforms.uNight.value = s.night;
    waterMat.uniforms.uSunI.value = clamp(s.day + 0.2, 0, 1);
    waterMat.uniforms.uSunDir.value.set(s.dir.x, Math.max(s.dir.y, 0.05), s.dir.z);
  }

  nightK = s.night;
  osmCity?.setNight(s.night);
  lastSunDir.set(s.dir.x, s.dir.y, s.dir.z);
  for (const m of realTowerMats) m.emissiveIntensity = nightK * 0.34;   // 真楼夜间亮化
  city?.setNight(s.night);
  cars?.setNight(s.night);
  landmarks?.setNight(s.night);
  lights?.setNight(s.night);
  bridges?.setNight(s.night);
  metro?.setNight(s.night);
  propsSys?.setNight(s.night);

  scene.fog.color.copy(FOG_DAY.clone().lerp(FOG_NIGHT, clamp(s.night + s.dusk * 0.5, 0, 1)));
  scene.fog.far = lerp(16000, 9000, s.night);
  setEnvIntensity(lerp(0.25, 1, clamp(s.day + s.dusk * 0.4, 0, 1)));

  $('#clockVal').textContent = `${String(Math.floor(hours) % 24).padStart(2, '0')}:${String(Math.floor((hours % 1) * 60)).padStart(2, '0')}`;
}

/* ==================== 构建 ==================== */
step('初始化渲染器', () => initRenderer());
step('生成地面与七山', () => {
  const ground = buildGround();
  scene.add(ground.mesh);
  scene.add(buildMountains());
});
step('生成两江与湖泊', () => {
  waterMat = createWaterMaterial();
  waterGroup = buildWater(waterMat);
  scene.add(waterGroup);
});
step('铺设主干道网', () => {
  roads = buildRoads();
  scene.add(roads.group);
});
step('精建 16 处地标', () => {
  landmarks = buildLandmarks();
  // 黄鹤楼/绿地中心后续由真实模型替换:保留独立 mesh 供换模隐藏
  // (合班会删原件烘进 merged,之后的 lm:*.visible=false 就成了空操作——程序化塔将永远可见)
  const keep = new Set();
  for (const id of ['lm:huanghelou', 'lm:greenland']) {
    const s = landmarks.group.getObjectByName(id);
    if (s) keep.add(s);
  }
  const merged = mergeStaticMeshes(landmarks.group, keep);
  console.log(`[GTA-WH] 地标合批: ${merged.before} → ${merged.after} 个 mesh(${merged.tris} 三角形,保留 ${keep.size} 处换模位)`);
  scene.add(landmarks.group);
});
step('架设五座大桥', () => {
  bridges = buildBridges();
  scene.add(bridges.group);
});
step('装载 OSM 真实城市', async () => {
  try {
    const [bRes, rRes] = await Promise.all([
      fetch('./data/osm/buildings.json'),
      fetch('./data/osm/roads.json'),
    ]);
    if (!bRes.ok || !rRes.ok) throw new Error(`buildings:${bRes.status} roads:${rRes.status}`);
    const [buildings, osmRoads] = await Promise.all([bRes.json(), rRes.json()]);
    osmCity = await buildOsmCity(buildings);
    scene.add(osmCity.group);
    if (osmCity.boxes) worldCollision.addRaw(osmCity.boxes);
    console.log(`[GTA-WH] OSM 真实建筑: ${osmCity.count} 栋(ODbL)`);
    const osmR = buildOsmRoads(osmRoads);
    scene.add(osmR.group);
    // 手绘路网在 OSM 覆盖区内隐藏(OSM 路网替代;中心线走廊保留供行驶)
    roads.group.visible = false;
    driveLines = osmR.centerlines.length ? osmR.centerlines : roads.centerlines;
    console.log(`[GTA-WH] OSM 路网: ${osmR.centerlines.length} 条`);
  } catch (e) {
    console.warn('[GTA-WH] OSM 数据不可用,使用程序化城市:', e.message);
    driveLines = roads.centerlines;
  }
});
step('生成三镇城市体块', () => {
  // 排他圆:地标 + Sketchfab 真楼 + 摄影测量模型(旧版 `...toV2()` 会把
  // 数组展开成 {0:x,1:z},e.x/e.z 为 undefined → 排他判定恒不生效)
  const sites = allExclusions();
  // OSM 覆盖区内不再程序化生成(真实建筑已就位);传入真实路网走廊做体块避让
  city = buildCity({
    exclusions: sites,
    osmBox: osmCity ? OSM_BOX_SCENE : null,
    corridors: driveLines,
  });
  scene.add(city.group);
  if (city.boxes) worldCollision.addRaw(city.boxes);
  worldCollision.build();
  console.log(`[GTA-WH] 程序化补充建筑: ${city.count} 栋${osmCity ? '(OSM 框外)' : ''}`);
  console.log(`[GTA-WH] 碰撞网格: ${worldCollision.n} 个占地盒`);
});
step('栽种行道树与樱花', async () => {
  trees = await buildTrees({
    exclusions: allExclusions(),
    lines: driveLines || null,
    blocked: (x, z) => !worldCollision.free(x, z, 0, 1.5),   // 树不穿楼
  });
  scene.add(trees.group);
  console.log(`[GTA-WH] 树木: ${trees.count}`);
});
step('放行车流与路灯', async () => {
  cars = await buildCars(driveLines || roads.centerlines, 170);
  scene.add(cars.group);
  lights = buildStreetLights(driveLines || roads.centerlines, 777,
    (x, z) => !worldCollision.free(x, z, 0, 0.8));            // 灯杆不立进楼里
  scene.add(lights.group);
  console.log(`[GTA-WH] 路灯: ${lights.count}`);
  metro = buildMetro();
  scene.add(metro.group);
  npcs = await buildNPCs(driveLines || roads.centerlines, 60);
  scene.add(npcs.group);
  console.log(`[GTA-WH] 行人 NPC: ${npcs.count}`);
  propsSys = await buildStreetProps(driveLines || roads.centerlines, 320);
  scene.add(propsSys.group);
  console.log(`[GTA-WH] 街道小品: ${propsSys.count}(红绿灯 ${propsSys.traffic ?? 0})`);
  ferry = buildFerry();
  scene.add(ferry.group);
  // 绿地中心塔顶航空障碍灯(红,闪烁)
  const [gx, gz] = toV2(114.3366, 30.6152);
  beacon = new THREE.Mesh(
    new THREE.SphereGeometry(3.2, 10, 8),
    new THREE.MeshBasicMaterial({ color: 0xff2020 }),
  );
  beacon.position.set(gx, Math.max(terrainHeight(gx, gz), 0) + 468, gz);
  scene.add(beacon);
});
step('装配玩法与 HUD', () => {
  hud = initHUD({
    onGoto: (item) => {
      // 观察模式飞到地标(按建筑高度自适应取景:高楼看远,小景看近)
      game.setMode('orbit', true);
      const [x, z] = toV2(item.lon, item.lat);
      const h = item.heightM || 20;
      const dist = h > 200 ? h * 2.2 : h * 2.8 + 90;
      camera.position.set(x - dist * 0.72, Math.max(terrainHeight(x, z), 0) + h * 0.8 + 26, z + dist * 0.78);
      controls.target.set(x, Math.max(terrainHeight(x, z), 0) + h * 0.45, z);
      controls.update();
    },
    onToggleTour: () => hud.setTour(true),
  });
  game = new Game(scene, camera, hud);
  window.__hud = hud;      // 供 tools/tour.mjs 等验收脚本调用
  window.__game = game;    // 供验收脚本摆放机位/切模式
  window.__scene = scene;
  window.__three = { toV2, terrainHeight };   // 验收脚本摆机位用
});
step('烘焙环境光照', () => {
  try {
    env = createEnvironment(renderer);
    scene.environment = env.update(timeHours);
  } catch (e) { console.warn('环境烘焙不可用:', e); }
});
step('装载 Sketchfab 真实地标楼群', async () => {
  for (const t of REAL_TOWERS) {
    const g = await loadGLB(`./assets/models/${t.dir}/scene.gltf`);
    if (!g) { console.warn(`[GTA-WH] 真楼缺失:${t.dir}`); continue; }
    // 归一化到实测高度,底面贴地,水平居中
    const box = new THREE.Box3().setFromObject(g);
    const scale = t.h / Math.max(box.max.y - box.min.y, 0.01);
    g.scale.setScalar(scale);
    g.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(g);
    const [x, z] = toV2(t.lon, t.lat);
    const gy = Math.max(terrainHeight(x, z), 0);
    // 下沉 1.5 m:坡地上模型底面与地形之间不会露出缝
    g.position.set(x - (b2.max.x + b2.min.x) / 2, gy - b2.min.y - 1.5, z - (b2.max.z + b2.min.z) / 2);
    scene.add(g);
    // 夜间亮化:emissiveMap 复用漫反射贴图,入夜整楼透出暖光(窗格纹理即亮纹)
    g.traverse((o) => {
      if (!o.isMesh || !o.material) return;
      const list = Array.isArray(o.material) ? o.material : [o.material];
      for (const m of list) {
        if (m.map && !m.userData.lit) {
          m.emissive = new THREE.Color('#b08a52');
          m.emissiveMap = m.map;
          m.emissiveIntensity = 0;
          m.userData.lit = true;
          realTowerMats.push(m);
        }
      }
    });
    // 替换程序化版本(隐藏绿地中心的 Lathe 模型,保留 POI 数据)
    if (t.replace) {
      const sub = landmarks.group.getObjectByName(t.replace);
      if (sub) sub.visible = false;
    }
    console.log(`[GTA-WH] 真实地标:${t.dir}(${t.h} m,Void.com CC-BY)`);
  }
});

step('黄鹤楼精建模(China_Tower,现役唯一模型)', async () => {
  // China_Tower LOD2(0G-Bhqc,MIT,1.37M 面,全分辨率贴图)
  // 旧摄影测量版(yellow-crane-tower)已于 2026-10-05 删除;GLB 加载失败时保留程序化地标兜底
  const g = await loadGLB('./assets/models/huanghe-tower/huanghe-main-tower-lod2.glb');
  window.__hhltBadge = 'HHLT:精建模';
  if (!g) {
    window.__hhltBadge = 'HHLT:⚠程序化回退';
    console.error('[GTA-WH] ⚠ 黄鹤楼精建模 GLB 加载失败,保留程序化版——请截图此行反馈');
    return;
  }
  // 归一化:楼体 51.4 m(China_Tower 原生 37.2 m 高,等比放大)
  const box = new THREE.Box3().setFromObject(g);
  const scale = 51.4 / Math.max(box.max.y - box.min.y, 0.01);
  g.scale.setScalar(scale);
  g.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(g);
  const [x, z] = toV2(114.296944, 30.546944);   // Wikidata Q462372 = Overture 实测轮廓中心(误差 16m)
  const gy = Math.max(terrainHeight(x, z), 0);
  // 蛇山是坡地,下沉 2 m 兜底,避免台基底部悬空
  g.position.set(x - (b2.max.x + b2.min.x) / 2, gy - b2.min.y - 2, z - (b2.max.z + b2.min.z) / 2);
  // 夜间金顶泛光
  g.traverse((o) => {
    if (o.isMesh && o.material && !Array.isArray(o.material) && o.material.map && !o.material.userData.lit) {
      o.material.emissive = new THREE.Color('#8a6222');
      o.material.emissiveMap = o.material.map;
      o.material.emissiveIntensity = 0;
      o.material.userData.lit = true;
      realTowerMats.push(o.material);
    }
  });
  // 琉璃瓦金顶+朱红柱廊:上游模型屋面与白墙共用纯白贴图(Material#25,120 万顶点),
  // 写顶点色分三段——坡屋面/飞檐(法线朝上)染金,每层平座带(楼层密集区下缘)染朱红,墙面保持白
  // (abs:模型带镜像变换;不用 onBeforeCompile——程序缓存导致补丁不生效)
  // 楼层带为相对塔基高度,取自顶点高度直方图实测(5 层平座位置)
  {
    const GOLD = new THREE.Color('#e8b33a');
    const RED = new THREE.Color('#a83226');
    const RED_BANDS = [[0.5, 3.2], [8.3, 10.8], [15.3, 17.8], [21.3, 23.8], [28.3, 31.5]];
    const _q = new THREE.Quaternion(), _v = new THREE.Vector3(), _n = new THREE.Vector3();
    const y0 = b2.min.y;
    g.updateMatrixWorld(true);
    g.traverse((o) => {
      if (!o.isMesh || !o.geometry?.attributes?.normal) return;
      const m = Array.isArray(o.material) ? null : o.material;
      if (!m || m.userData.goldVerts) return;
      m.userData.goldVerts = true;
      const nor = o.geometry.attributes.normal;
      o.getWorldQuaternion(_q);
      const n = nor.count;
      const col = new Float32Array(n * 3);
      const pos = o.geometry.attributes.position;
      for (let i = 0; i < n; i++) {
        _v.set(pos.getX(i), pos.getY(i), pos.getZ(i)).applyMatrix4(o.matrixWorld);
        // 金:法线朝上度
        _n.set(nor.getX(i), nor.getY(i), nor.getZ(i)).applyQuaternion(_q);
        const ny = Math.abs(_n.y);
        const goldT = THREE.MathUtils.smoothstep(ny, 0.45, 0.72);
        // 红:楼层平座带
        const ry = _v.y - y0;
        let redT = 0;
        for (const [a, b] of RED_BANDS) {
          if (ry >= a && ry <= b) { redT = 1; break; }
        }
        let r = 1, gg = 1, bb = 1;
        if (redT) { r = RED.r; gg = RED.g; bb = RED.b; }
        r += goldT * (GOLD.r - r); gg += goldT * (GOLD.g - gg); bb += goldT * (GOLD.b - bb);
        col[i * 3] = r; col[i * 3 + 1] = gg; col[i * 3 + 2] = bb;
      }
      o.geometry.setAttribute('color', new THREE.BufferAttribute(col, 3));
      m.vertexColors = true;
      m.needsUpdate = true;
    });
    // 葫芦宝顶:模型攒尖顶欠圆润,叠加金色双球葫芦
    const goldMat = new THREE.MeshStandardMaterial({ color: '#d9a933', metalness: 0.65, roughness: 0.3 });
    const finial = new THREE.Group();
    const s1 = new THREE.Mesh(new THREE.SphereGeometry(1.35, 18, 14), goldMat);
    s1.position.y = 0.9;
    const s2 = new THREE.Mesh(new THREE.SphereGeometry(0.85, 16, 12), goldMat);
    s2.position.y = 2.4;
    const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 8), goldMat);
    rod.position.y = 3.5;
    finial.add(s1, s2, rod);
    finial.position.set(x, b2.max.y - 0.7, z);
    finial.traverse((o) => { if (o.isMesh) o.castShadow = true; });
    scene.add(finial);
    // "黄鹤楼"金字匾:顶层北面(长江/大桥一侧)
    const cv = document.createElement('canvas');
    cv.width = 512; cv.height = 144;
    const cx2 = cv.getContext('2d');
    cx2.fillStyle = '#14151c'; cx2.fillRect(0, 0, 512, 144);
    cx2.strokeStyle = '#c9a227'; cx2.lineWidth = 8; cx2.strokeRect(6, 6, 500, 132);
    cx2.fillStyle = '#e8c34a';
    cx2.font = 'bold 104px KaiTi, STKaiti, serif';
    cx2.textAlign = 'center'; cx2.textBaseline = 'middle';
    cx2.fillText('黄鹤楼', 256, 78);
    const plaqueTex = new THREE.CanvasTexture(cv);
    plaqueTex.colorSpace = THREE.SRGBColorSpace;
    const plaque = new THREE.Mesh(
      new THREE.BoxGeometry(6, 1.7, 0.25),
      [goldMat, goldMat, goldMat, goldMat, new THREE.MeshStandardMaterial({ map: plaqueTex, roughness: 0.6 }), goldMat],
    );
    plaque.position.set(x, y0 + 43.5, z - 9.6);
    plaque.rotation.y = Math.PI;
    plaque.castShadow = true;
    scene.add(plaque);
  }
  scene.add(g);
  const sub = landmarks.group.getObjectByName('lm:huanghelou');
  if (sub) sub.visible = false;
  console.log('[GTA-WH] 黄鹤楼:China_Tower 精建模(0G-Bhqc,MIT,1.37M 面,唯一模型)');
});

step('铜陵公铁大桥改造为武汉长江大桥', async () => {
  const g = await loadGLB('./assets/models/tongling-railway-bridge/scene.gltf');
  if (!g) { console.warn('[GTA-WH] 铜陵桥模型缺失,保留程序化大桥'); return; }
  // 对齐桥轴:长轴归一到 1670 m,旋转到 大桥 bearing,桥中点对齐
  const box = new THREE.Box3().setFromObject(g);
  const lenX = box.max.x - box.min.x, lenZ = box.max.z - box.min.z;
  const modelLen = Math.max(lenX, lenZ);
  const alongX = lenX >= lenZ;
  const scale = 1670 / Math.max(modelLen, 0.01);
  g.scale.setScalar(scale);
  g.updateMatrixWorld(true);
  const b2 = new THREE.Box3().setFromObject(g);
  // 桥面高对齐 deckH=26:桁架桥桥面约在整体高度上部 60% 处
  const h2 = b2.max.y - b2.min.y;
  const deckInModel = b2.min.y + h2 * 0.58;
  const BR = BRIDGES.find((b) => b.id === 'yangtzebridge');
  const [ax, az] = toV2(...BR.axis[0]);
  const [bx, bz] = toV2(...BR.axis[1]);
  const cx = (ax + bx) / 2, cz = (az + bz) / 2;
  const bearing = Math.atan2(bx - ax, bz - az);
  g.rotation.y = bearing + (alongX ? Math.PI / 2 : 0);
  g.position.set(cx - (b2.max.x + b2.min.x) / 2, 26 - deckInModel, cz - (b2.max.z + b2.min.z) / 2);
  // 夜间灯化
  g.traverse((o) => {
    if (o.isMesh && o.material && !Array.isArray(o.material) && o.material.map && !o.material.userData.lit) {
      o.material.emissive = new THREE.Color('#7a5a2e');
      o.material.emissiveMap = o.material.map;
      o.material.emissiveIntensity = 0;
      o.material.userData.lit = true;
      realTowerMats.push(o.material);
    }
  });
  scene.add(g);
  // 隐藏程序化桁架/桥墩(保留行驶桥面、桥头堡、下层列车、灯带)
  for (const name of ['yb-truss', 'yb-piers']) {
    const m = bridges.group.getObjectByName(name);
    if (m) m.visible = false;
  }
  // GLB 桥面与程序化桥面共面会 z-fighting:把程序化桥面沉进 GLB 箱梁里 0.4 m,
  // 既消除闪烁,又保留 GLB 缺失时的可见行驶面(行驶高度仍由 DECKS 注册表给出)
  for (const name of ['yb-road-deck']) {
    const m = bridges.group.getObjectByName(name);
    if (m) m.position.y -= 0.4;
  }
  console.log('[GTA-WH] 长江大桥:铜陵公铁大桥模型改造(hello123D,CC-BY,245k 面)');
});

step('装载 Kenney 车辆与街头停车', async () => {
  // 玩家座驾换装 Kenney Car Kit(CC0)
  await game?.vehicle.upgradeBody(loadGLB, './assets/cars/sedan-sports.glb');
  console.log('[GTA-WH] 玩家车:Kenney sedan-sports(CC0)');
  // 沿江大道静态停车:不同 Kenney 车型贴路缘
  const [ax, az] = toV2(114.2860, 30.5752);
  const parked = ['sedan.glb', 'taxi.glb', 'suv.glb', 'police.glb', 'van.glb', 'hatchback-sports.glb', 'truck.glb', 'race.glb'];
  for (let i = 0; i < parked.length; i++) {
    const t = i / parked.length;
    const px = ax + Math.cos(0.65) * t * 900;
    const pz = az - Math.sin(0.65) * t * 900;
    const g = await loadGLB('./assets/cars/' + parked[i], { rot: 0.65 });
    if (!g) continue;
    const box = new THREE.Box3().setFromObject(g);
    const len = Math.max(box.max.z - box.min.z, box.max.x - box.min.x, 0.01);
    g.scale.setScalar(4.6 / len);
    g.updateMatrixWorld(true);
    const b2 = new THREE.Box3().setFromObject(g);
    g.position.set(
      px - (b2.max.x + b2.min.x) / 2,
      Math.max(terrainHeight(px, pz), 0) - b2.min.y,
      pz - (b2.max.z + b2.min.z) / 2,
    );
    scene.add(g);
  }
  console.log(`[GTA-WH] 路边停车:${parked.length} 台 Kenney 车`);
});

function step(name, fn) { BUILD_STEPS.push([name, fn]); }

async function build() {
  for (let i = 0; i < BUILD_STEPS.length; i++) {
    loadText.textContent = BUILD_STEPS[i][0] + '……';
    await new Promise((r) => setTimeout(r, 16));
    await BUILD_STEPS[i][1]();
    loadBar.style.width = `${((i + 1) / BUILD_STEPS.length) * 100}%`;
  }
  applyTime(timeHours);
  $('#loading').classList.add('done');
  $('#buildStamp').textContent = 'build ' + BUILD_STAMP + (window.__hhltBadge ? ' | ' + window.__hhltBadge : '');
  hud.modeTip('按 2 驾车出发 · F 上下车 · 3 无人机 · 拖顶部滑杆调时间');
  requestAnimationFrame(animate);
}

/* ==================== 主循环 ==================== */
let fpsAcc = 0, fpsN = 0, hudAcc = 0;

function animate() {
  requestAnimationFrame(animate);
  const dt = Math.min(clock.getDelta(), 0.1);

  if (autoTime) {
    timeHours = (timeHours + dt * 0.25) % 24;
    $('#timeSlider').value = timeHours;
    applyTime(timeHours);
  }
  if (env) scene.environment = env.update(timeHours);
  if (waterMat) waterMat.uniforms.uTime.value += dt;

  // 玩法
  game?.update(dt, nightK, controls);

  // 阴影盒跟随玩家(静态时间下 applyTime 不跑,这里每帧保持太阳相对位置)
  if (game?._pos && sunLight) {
    sunLight.target.position.copy(game._pos);
    sunLight.position.copy(game._pos).addScaledVector(lastSunDir, 1800);
  }

  // 桥上列车 / 轻轨 / 轮渡 / 行人
  for (const u of bridges?.updates || []) u(dt);
  metro?.update(dt);
  ferry?.update(dt);
  npcs?.update(dt);

  // 塔顶航空障碍灯闪烁
  if (beacon) beacon.visible = (clock.elapsedTime % 1.6) < 0.9;

  // 车流
  cars?.update(dt);

  renderer.render(scene, camera);

  // HUD(4 Hz)
  hudAcc += dt; fpsAcc += dt; fpsN++;
  if (hudAcc > 0.25 && game?._pos) {
    hudAcc = 0;
    hud.drawMinimap(game._pos.x, game._pos.z, game._heading || 0, game.mode);
    elSpeedBox.classList.toggle('hidden', game.mode !== 'drive');
    if (game.mode === 'drive') elSpeed.textContent = Math.round(game.speedKmh);
    const [lo, la] = toLonLat(game._pos.x, game._pos.z);
    elCoord.textContent = `${la.toFixed(4)}°N, ${lo.toFixed(4)}°E`;
  }
  if (fpsAcc > 0.5) {
    elFps.textContent = `${Math.round(fpsN / fpsAcc)} fps`;
    fpsAcc = 0; fpsN = 0;
  }
}

/* ==================== 交互 ==================== */
$('#timeSlider').addEventListener('input', (e) => {
  timeHours = +e.target.value;
  applyTime(timeHours);
});
window.addEventListener('keydown', (e) => {
  const k = e.key.toLowerCase();
  if (k === 'n') autoTime = !autoTime;
  if (k === 'h') $('#helpPanel').classList.toggle('hidden');
  if (k === 'l') $('#listPanel').classList.toggle('hidden');
});
$('#btnHelp').addEventListener('click', () => $('#helpPanel').classList.toggle('hidden'));
$('#btnList').addEventListener('click', () => $('#listPanel').classList.toggle('hidden'));

build();

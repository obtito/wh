import { createPoints, filterPoints, layoutLabels, pointRequest, validateRoads } from './plan.js';
import { verifySnapshot } from './snapshot-check.js';

const $ = id => document.getElementById(id);
const startedAt = performance.now();
const lifetime = new AbortController();
let disposed = false, contextLost = false, frame = 0, animation = null;
async function fetchBytes(url) {
  const response = await fetch(url, { cache: 'no-cache', signal: AbortSignal.any([lifetime.signal, AbortSignal.timeout(20_000)]) });
  if (!response.ok) throw new Error(`底图读取失败 (${response.status})：${url}`);
  const bytes = new Uint8Array(await response.arrayBuffer());
  if (bytes.length > 10 * 1024 * 1024) throw new Error('底图文件超过支持范围');
  return bytes;
}
const decode = bytes => new TextDecoder('utf-8', { fatal: true }).decode(bytes);
const manifest = JSON.parse(decode(await fetchBytes('./snapshot/snapshot.json')));
const files = await verifySnapshot(manifest, name => fetchBytes(`./snapshot/${name}`));
const [THREE, { OrbitControls }, world, lib, geo, data, layout] = await Promise.all([
  import('three'), import('three/addons/OrbitControls.js'), import('./snapshot/js/world.js'),
  import('./snapshot/js/lib.js'), import('./snapshot/js/geo.js'), import('./snapshot/js/data.js'), import('./snapshot/js/road-layout.js'),
]);
const roadCollections = {
  scene: validateRoads(JSON.parse(decode(files.get('data/osm/roads-land.json')))),
  original: validateRoads(JSON.parse(decode(files.get('data/osm/roads.json')))),
};
const points = createPoints(data.LANDMARKS, manifest.baseVersion, geo.toV2);
let selected = points[0], mode = 'scene', top = false, renders = 0;
const viewport = $('viewport'), labels = $('labels');
const callouts = document.createElementNS('http://www.w3.org/2000/svg', 'svg');
callouts.classList.add('callouts'); callouts.setAttribute('aria-hidden', 'true'); labels.append(callouts);
const scene = new THREE.Scene(); scene.background = new THREE.Color('#dfe5d4');
scene.fog = new THREE.Fog('#dfe5d4', 28_000, 80_000);
const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
renderer.setPixelRatio(Math.min(devicePixelRatio, 1.5));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.25;
renderer.domElement.setAttribute('aria-label', '武汉参考底图：道路、水系与待建点位，不含建筑模型');
viewport.append(renderer.domElement);
// City overview distances are kilometres; a 5 m near plane loses the separation
// between the existing 0.5 m water surface and ground. Keep all source heights intact.
const camera = new THREE.PerspectiveCamera(44, 1, 250, 90_000);
const controls = new OrbitControls(camera, renderer.domElement);
controls.enableDamping = false; controls.minDistance = 500; controls.maxDistance = 60_000;
controls.maxPolarAngle = Math.PI * .47; controls.enableKeys = false;
scene.add(new THREE.HemisphereLight('#fff9e9', '#7c9872', 2.1));
const sunlight = new THREE.DirectionalLight('#fff1d5', 2.3); sunlight.position.set(-12_000, 20_000, 10_000); scene.add(sunlight);
const ground = world.buildGround(); ground.mat.color.set('#c2cba9'); scene.add(ground.mesh);
const terrain = world.buildMountains(); scene.add(terrain);
// Original close-up waves (~22 m) alias into a grid at city-overview scale.
// Change only the presentation material; retain the original water footprints/heights.
const waterMaterial = new THREE.MeshStandardMaterial({ color: '#659994', roughness: .86, metalness: .05,
  polygonOffset: true, polygonOffsetFactor: -1, polygonOffsetUnits: -1 });
const water = world.buildWater(waterMaterial); scene.add(water);
// These are reference bridge axes, never the original detailed bridge models.
const bridgeAxes = new THREE.Group(); bridgeAxes.name = 'reference-bridge-axes'; scene.add(bridgeAxes);
for (const bridge of data.BRIDGES) {
  const positions = bridge.axis.map(([lon, lat]) => {
    const [x, z] = geo.toV2(lon, lat); return new THREE.Vector3(x, Math.max(12, world.terrainSurfaceHeight(x, z) + 2), z);
  });
  const geometry = new THREE.BufferGeometry().setFromPoints(positions);
  bridgeAxes.add(new THREE.Line(geometry, new THREE.LineBasicMaterial({ color: '#ad9a6e' })));
}
const heightCache = new Map();
function height(x, z) {
  const key = `${Math.round(x)},${Math.round(z)}`;
  if (!heightCache.has(key)) heightCache.set(key, world.terrainSurfaceHeight(x, z));
  return heightCache.get(key);
}
function disposeGroup(group) {
  if (!group) return;
  const geometries = new Set(), materials = new Set(), textures = new Set();
  group.traverse(object => {
    if (object.geometry) geometries.add(object.geometry);
    for (const material of Array.isArray(object.material) ? object.material : [object.material]) {
      if (!material) continue; materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  geometries.forEach(geometry => geometry.dispose()); textures.forEach(texture => texture.dispose()); materials.forEach(material => material.dispose());
}
function makeRoads(collection) {
  // Batch by display class. The original vectors remain unchanged in the snapshot.
  const buckets = [[], []], indices = [[], []]; let displayedRecords = 0;
  for (const road of collection) {
    const width = layout.roadWidth(road.t); if (width === null) continue;
    const points = road.g.map(([lon, lat]) => geo.toV2(lon, lat));
    const bridge = layout.isBridgeRoad(road.t), bucket = bridge ? 1 : 0;
    const geometry = lib.ribbonGeometry(points, width, 0);
    const position = geometry.getAttribute('position');
    const offset = buckets[bucket].length / 3;
    for (let i = 0; i < position.count; i++) {
      const x = position.getX(i), z = position.getZ(i);
      buckets[bucket].push(x, Math.max(bridge ? 12 : 0, height(x, z)) + 1.5, z);
    }
    for (const index of geometry.index.array) indices[bucket].push(offset + index);
    geometry.dispose(); displayedRecords++;
  }
  const group = new THREE.Group(); group.name = 'reference-roads';
  buckets.forEach((vertices, index) => {
    if (!vertices.length) return;
    const geometry = new THREE.BufferGeometry(); geometry.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
    geometry.setIndex(indices[index]); geometry.computeVertexNormals(); geometry.computeBoundingSphere();
    group.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ color: index ? '#a99a77' : '#788575', side: THREE.DoubleSide })));
  });
  group.userData.displayedRecords = displayedRecords;
  return group;
}
let roads = makeRoads(roadCollections.scene); scene.add(roads);
const markers = new THREE.Group(); markers.name = 'pending-point-markers'; scene.add(markers);
const buttons = new Map(), rings = new Map();
const markerGeometry = new THREE.RingGeometry(58, 82, 40).rotateX(-Math.PI / 2);
for (const point of points) {
  const material = new THREE.MeshBasicMaterial({ color: '#ac8450', side: THREE.DoubleSide, transparent: true, opacity: .9 });
  const marker = new THREE.Mesh(markerGeometry, material); marker.position.set(point.x, height(point.x, point.z) + 2.5, point.z);
  marker.userData.pointId = point.pointId; markers.add(marker); rings.set(point.pointId, marker);
  const button = document.createElement('button'); button.className = 'map-label'; button.textContent = point.name;
  button.dataset.pointId = point.pointId; button.setAttribute('aria-label', `查看${point.name}待建点位`);
  button.addEventListener('click', () => selectPoint(point), { signal: lifetime.signal }); labels.append(button); buttons.set(point.pointId, button);
}
const projected = new THREE.Vector3();
function updateLabels() {
  const { width, height: h } = viewport.getBoundingClientRect();
  const entries = []; callouts.replaceChildren(); callouts.setAttribute('viewBox', `0 0 ${width} ${h}`);
  for (const point of points) {
    const button = buttons.get(point.pointId), ring = rings.get(point.pointId);
    projected.copy(ring.position); projected.y += 15; projected.project(camera);
    const x = (projected.x * .5 + .5) * width, y = (-projected.y * .5 + .5) * h;
    button.hidden = projected.z < -1 || projected.z > 1 || x < 15 || x > width - 15 || y < 155 || y > h - 80;
    button.setAttribute('aria-pressed', String(point.pointId === selected.pointId));
    if (!button.hidden) entries.push({ id: point.pointId, x, y, width: button.offsetWidth, height: button.offsetHeight, selected: selected.pointId === point.pointId });
  }
  const placed = layoutLabels(entries, width, h, 150, 90);
  const visible = new Set(placed.map(item => item.id));
  for (const entry of entries) if (!visible.has(entry.id)) buttons.get(entry.id).hidden = true;
  for (const item of placed) {
    const button = buttons.get(item.id); button.style.left = `${item.x}px`; button.style.top = `${item.y}px`;
    const line = document.createElementNS(callouts.namespaceURI, 'line');
    line.setAttribute('x1', item.x); line.setAttribute('y1', item.y); line.setAttribute('x2', item.anchorX); line.setAttribute('y2', item.anchorY);
    line.setAttribute('stroke', '#a38962'); line.setAttribute('stroke-width', '1');
    const dot = document.createElementNS(callouts.namespaceURI, 'circle');
    dot.setAttribute('cx', item.anchorX); dot.setAttribute('cy', item.anchorY); dot.setAttribute('r', '3.5');
    dot.setAttribute('fill', item.id === selected.pointId ? '#365f49' : '#ac8450'); dot.setAttribute('stroke', '#fff6de');
    callouts.append(line, dot);
  }
}
function invalidate() {
  if (disposed || contextLost || document.hidden || frame) return;
  frame = requestAnimationFrame(render);
}
function render(now) {
  frame = 0; if (disposed || contextLost || document.hidden) return;
  if (animation) {
    const t = Math.min(1, (now - animation.start) / 550), eased = t * t * (3 - 2 * t);
    camera.position.lerpVectors(animation.fromCamera, animation.toCamera, eased);
    controls.target.lerpVectors(animation.fromTarget, animation.toTarget, eased);
    if (t >= 1) animation = null;
    controls.update();
  }
  renderer.render(scene, camera); renders++; updateLabels();
  const canvas = renderer.domElement;
  canvas.dataset.renders = String(renders); canvas.dataset.calls = String(renderer.info.render.calls);
  canvas.dataset.triangles = String(renderer.info.render.triangles); canvas.dataset.geometries = String(renderer.info.memory.geometries);
  canvas.dataset.textures = String(renderer.info.memory.textures); canvas.dataset.roadMode = mode;
  if (animation) invalidate();
}
function moveCamera(target, offset, immediate = false) {
  const destination = target.clone().add(offset);
  if (immediate || matchMedia('(prefers-reduced-motion: reduce)').matches) {
    animation = null; controls.target.copy(target); camera.position.copy(destination); controls.update();
  } else animation = { start: performance.now(), fromCamera: camera.position.clone(), toCamera: destination,
    fromTarget: controls.target.clone(), toTarget: target.clone() };
  invalidate();
}
function overview(immediate = false) {
  top = false; $('top').setAttribute('aria-pressed', 'false');
  const fit = Math.max(1, .9 / camera.aspect);
  moveCamera(new THREE.Vector3(1800, 0, -3800), new THREE.Vector3(6000 * fit, 23000 * fit, 18000 * fit), immediate);
}
function refreshList() {
  const visible = filterPoints(points, $('search').value), list = $('point-list'); list.replaceChildren();
  $('no-points').hidden = Boolean(visible.length);
  visible.forEach(point => {
    const button = document.createElement('button'); button.dataset.pointId = point.pointId;
    button.setAttribute('aria-pressed', String(selected.pointId === point.pointId));
    const number = document.createElement('span'); number.className = 'index'; number.textContent = String(points.indexOf(point) + 1).padStart(2, '0');
    const text = document.createElement('span'); text.textContent = point.name;
    const state = document.createElement('small'); state.textContent = '待建'; button.append(number, text, state);
    button.addEventListener('click', () => selectPoint(point), { once: true }); list.append(button);
  });
}
function selectPoint(point, focus = true) {
  selected = point; $('point-name').textContent = point.name;
  $('point-description').textContent = '保留参考位置，建筑暂不加载。标记圆仅用于交互，不是已核定的占地范围。';
  const details = [['点位 ID', point.pointId], ['参考经纬度', `${point.lon.toFixed(6)}°E / ${point.lat.toFixed(6)}°N`],
    ['坐标来源', 'GTA-WH 本地场景数据 · 尚未逐点复核'], ['占地与朝向', '待核对，未设置提交验收阈值'],
    ['模型与版本', '无候选模型 · 无社区采纳版本'], ['底图版本', manifest.baseVersion.slice(0, 16)]];
  $('point-details').replaceChildren();
  for (const [label, value] of details) {
    const dt = document.createElement('dt'), dd = document.createElement('dd'); dt.textContent = label; dd.textContent = value; $('point-details').append(dt, dd);
  }
  for (const [id, ring] of rings) ring.material.color.set(id === point.pointId ? '#365f49' : '#ac8450');
  $('download').disabled = false; refreshList();
  if (focus) { top = false; $('top').setAttribute('aria-pressed', 'false'); moveCamera(rings.get(point.pointId).position.clone(), new THREE.Vector3(1800, 2500, 2700)); }
  invalidate();
}
function status() {
  $('status').textContent = `${mode === 'scene' ? '场景调整' : '原始参考'}路网 ${roadCollections[mode].length.toLocaleString()} 条记录 · 8 处待建点位。没有提交或上链。`;
}
controls.addEventListener('change', invalidate);
controls.addEventListener('start', () => { animation = null; });
const resize = new ResizeObserver(() => {
  const { width, height: h } = viewport.getBoundingClientRect();
  if (!width || !h) return;
  renderer.setSize(width, h); camera.aspect = width / h; camera.updateProjectionMatrix(); invalidate();
});
resize.observe(viewport);
$('overview').addEventListener('click', () => overview(), { signal: lifetime.signal });
$('top').addEventListener('click', () => {
  top = !top; $('top').setAttribute('aria-pressed', String(top));
  const target = controls.target.clone(), distance = camera.position.distanceTo(target);
  moveCamera(target, top ? new THREE.Vector3(0, distance, 10) : new THREE.Vector3(distance * .22, distance * .8, distance * .6));
}, { signal: lifetime.signal });
$('search').addEventListener('input', refreshList, { signal: lifetime.signal });
$('road-mode').addEventListener('change', () => {
  mode = $('road-mode').value;
  const replacement = makeRoads(roadCollections[mode]); replacement.visible = $('roads-toggle').checked;
  scene.remove(roads); disposeGroup(roads); roads = replacement; scene.add(roads); status(); invalidate();
}, { signal: lifetime.signal });
$('roads-toggle').addEventListener('change', () => { roads.visible = $('roads-toggle').checked; bridgeAxes.visible = roads.visible; invalidate(); }, { signal: lifetime.signal });
$('terrain-toggle').addEventListener('change', () => { terrain.visible = $('terrain-toggle').checked; invalidate(); }, { signal: lifetime.signal });
$('download').addEventListener('click', () => {
  const blob = new Blob([`${JSON.stringify(pointRequest(selected), null, 2)}\n`], { type: 'application/json' });
  const url = URL.createObjectURL(blob), link = document.createElement('a'); link.href = url;
  link.download = `${selected.pointId.replace(':', '-')}-request-draft.json`; document.body.append(link); link.click(); link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}, { signal: lifetime.signal });
$('sources').addEventListener('click', () => {
  $('source-info').textContent = JSON.stringify({ source: manifest.source, baseVersion: manifest.baseVersion,
    capturedAt: manifest.capturedAt, counts: manifest.counts, roadAdjustments: manifest.roadAdjustments,
    boundaries: manifest.boundaries, attribution: manifest.attribution }, null, 2); $('source-dialog').showModal();
}, { signal: lifetime.signal });
$('close-sources').addEventListener('click', () => $('source-dialog').close(), { signal: lifetime.signal });
renderer.domElement.addEventListener('webglcontextlost', event => {
  event.preventDefault(); contextLost = true; animation = null; cancelAnimationFrame(frame); frame = 0;
  renderer.domElement.dataset.ready = 'false'; $('error').hidden = false;
  $('error').textContent = '地图图形上下文已丢失，渲染暂停。等待浏览器恢复，或手动重新读取地图。';
  $('retry').hidden = false; $('retry').onclick = () => location.reload();
  document.querySelectorAll('.map-tools button, .map-tools input, .map-tools select, #search, #point-list button, .map-label, #download').forEach(element => { element.disabled = true; });
}, { signal: lifetime.signal });
renderer.domElement.addEventListener('webglcontextrestored', () => {
  if (disposed) return;
  contextLost = false; $('error').hidden = true; $('retry').hidden = true;
  document.querySelectorAll('.map-tools button, .map-tools input, .map-tools select, #search, #point-list button, .map-label, #download').forEach(element => { element.disabled = false; });
  renderer.domElement.dataset.ready = 'true'; status(); invalidate();
}, { signal: lifetime.signal });
document.addEventListener('visibilitychange', () => { if (!document.hidden) invalidate(); }, { signal: lifetime.signal });
window.addEventListener('pagehide', event => {
  if (event.persisted) { cancelAnimationFrame(frame); frame = 0; animation = null; return; }
  disposed = true; lifetime.abort(); cancelAnimationFrame(frame); resize.disconnect(); controls.dispose(); disposeGroup(scene); renderer.dispose();
}, { signal: lifetime.signal });
window.addEventListener('pageshow', () => invalidate(), { signal: lifetime.signal });
const bounds = viewport.getBoundingClientRect(); renderer.setSize(bounds.width, bounds.height); camera.aspect = bounds.width / bounds.height; camera.updateProjectionMatrix();
selectPoint(selected, false); overview(true); status();
$('point-count').textContent = String(points.length);
document.querySelectorAll('.map-tools button, .map-tools input, .map-tools select, #search, #sources').forEach(element => { element.disabled = false; });
$('loading').hidden = true; viewport.setAttribute('aria-busy', 'false');
renderer.domElement.dataset.ready = 'true'; renderer.domElement.dataset.baseVersion = manifest.baseVersion;
renderer.domElement.dataset.initializationMs = String(Math.round(performance.now() - startedAt));
renderer.domElement.dataset.modelAssets = '0';
invalidate();

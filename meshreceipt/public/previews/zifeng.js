import { createCinematicTransition } from '/api/source/nanjing/js/preview-cinematic.js';
// Presentation adapted from GTA-NJ/preview-zifeng.mjs. The original repository
// (including its local edits), model geometry and materials remain untouched.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildZifeng } from '/api/source/nanjing/js/zifeng.js';
import { LANDMARKS } from '/api/source/nanjing/js/data.js';
import { createPreviewLoop, createPreviewStatus, bindPreviewLifecycle, disposePreviewScene } from '/api/source/nanjing/js/preview-loop.js';
import { ZIFENG_COVER_VIEW, zifengFrame } from './zifeng-framing.js';

const previewStatus = createPreviewStatus();

const startedAt = performance.now();
const query = new URLSearchParams(location.search), coverMode = query.get('cover') === '1';
document.documentElement.classList.toggle('cover-mode', coverMode);
const viewport = coverMode ? document.getElementById('poster-stage') : document.body;
const landmark = LANDMARKS.find(item => item.id === 'zifeng');
if (!landmark) throw new Error('GTA-NJ 中缺少紫峰大厦数据');
const building = buildZifeng(landmark), scene = new THREE.Scene();
scene.add(building);
// Bounds are captured BEFORE adding the presentation ground.
const bounds = new THREE.Box3().setFromObject(building);
const size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
// Capture a conservative silhouette once. A single box reserves the podium's
// full width beside the needle-like spire and makes the first frame too small.
// Each band encloses all of its vertices; fitting its eight corners also keeps
// the triangles and the tip inside the safe area at every preset direction.
const framingBands = Array.from({ length: 64 }, () => new THREE.Box3());
const framingPoint = new THREE.Vector3();
building.traverse(object => {
  const positions = object.geometry?.attributes.position;
  if (!positions) return;
  for (let i = 0; i < positions.count; i++) {
    framingPoint.fromBufferAttribute(positions, i).applyMatrix4(object.matrixWorld);
    const band = Math.min(framingBands.length - 1, Math.max(0,
      Math.floor((framingPoint.y - bounds.min.y) / size.y * framingBands.length)));
    framingBands[band].expandByPoint(framingPoint);
  }
});
const framingEnvelope = framingBands.filter(band => !band.isEmpty()).flatMap(band =>
  [band.min.x, band.max.x].flatMap(x => [band.min.y, band.max.y].flatMap(y => [band.min.z, band.max.z].map(z => ({
    x: x - center.x, y: y - center.y, z: z - center.z,
  })))));
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 600);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.shadowMap.autoUpdate = false;
renderer.domElement.setAttribute('aria-label', '紫峰大厦交互式三维模型');
viewport.appendChild(renderer.domElement);
const controls = new OrbitControls(camera, renderer.domElement);
Object.assign(controls, { enableDamping: false, rotateSpeed: 0.85, zoomSpeed: 0.65,
  panSpeed: 0.65, screenSpacePanning: true, minPolarAngle: 0.12,
  minDistance: 2, maxDistance: 100, maxPolarAngle: Math.PI * 0.52, autoRotateSpeed: 0.6 });
controls.target.copy(center);
let loop;
let dirty = true;
const invalidate = () => { dirty = true; loop?.invalidate(); };
controls.addEventListener('change', invalidate);
const cinematic = createCinematicTransition({ renderer, scene, camera, controls, invalidate });

const ground = new THREE.Mesh(new THREE.PlaneGeometry(2000, 2000),
  new THREE.MeshStandardMaterial({ color: '#d5dde0', roughness: 1 }));
ground.rotation.x = -Math.PI / 2;
ground.position.y = bounds.min.y - 0.014;
ground.receiveShadow = true;
const ambient = new THREE.AmbientLight(0xddeaf4, 0.35);
const hemi = new THREE.HemisphereLight(0xe0efff, 0x9fa9ad, 0.9);
const key = new THREE.DirectionalLight(0xfff4e6, 2.3);
key.position.set(22, 38, 25);
key.target.position.copy(center);
key.castShadow = true;
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 90 });
key.shadow.normalBias = 0.012;
key.shadow.bias = -0.00008;
const fill = new THREE.DirectionalLight(0xb9d4f1, 0.8);
fill.position.set(-24, 18, -18);
scene.add(ground, ambient, hemi, key, key.target, fill);

// Keep the source preview's soft sky and glass reflections in both modes.
const environments = new Map();
function makeEnvironment(night) {
  if (environments.has(night)) return environments.get(night);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = new THREE.Scene();
  const geometry = new THREE.SphereGeometry(100, 32, 20), position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const sky = new THREE.Color(night ? '#364f70' : '#d8e9f5');
  const horizon = new THREE.Color(night ? '#162437' : '#aebabe'), color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const amount = THREE.MathUtils.clamp(position.getY(i) / 100 * 0.5 + 0.5, 0, 1);
    color.lerpColors(horizon, sky, Math.pow(amount, 0.65)).toArray(colors, i * 3);
  }
  geometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  environment.add(new THREE.Mesh(geometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  for (const [x, y, z, brightness] of [[-50, 30, -45, 2.8], [40, 55, 45, 4]]) {
    const light = new THREE.Mesh(new THREE.PlaneGeometry(30, 65), new THREE.MeshBasicMaterial({
      color: new THREE.Color().setScalar(night ? brightness * 0.14 : brightness), side: THREE.DoubleSide }));
    light.position.set(x, y, z); light.lookAt(0, 0, 0); environment.add(light);
  }
  const result = pmrem.fromScene(environment, 0.03);
  pmrem.dispose();
  environment.traverse(object => { object.geometry?.dispose(); object.material?.dispose(); });
  environments.set(night, result);
  return result;
}
function queryNumber(name, fallback) {
  const raw = query.get(name), value = raw === null || !raw.trim() ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
const initialAngle = queryNumber('angle', ZIFENG_COVER_VIEW.angle);
let night = query.get('mode') === 'night', automaticFraming = true;
function updateDirectionButtons(angle = null) {
  document.querySelectorAll('[data-angle]').forEach(button => {
    button.setAttribute('aria-pressed', String(angle !== null && Math.abs(Number(button.dataset.angle) - angle) < 0.001));
  });
}
function currentAngle() { return Math.atan2(camera.position.z - controls.target.z, camera.position.x - controls.target.x); }
function setRotation(enabled) {
  controls.autoRotate = enabled;
  document.getElementById('rotate').setAttribute('aria-pressed', String(enabled));
  if (enabled) { automaticFraming = true; updateDirectionButtons(); frameBuilding(currentAngle()); }
  invalidate();
}
function applyLighting() {
  const background = night ? '#101c2d' : coverMode ? '#e1e6de' : '#e4ebef';
  scene.background = new THREE.Color(background);
  scene.fog = new THREE.Fog(background, 40, 115);
  scene.environment = makeEnvironment(night).texture;
  ground.material.color.set(night ? '#162335' : coverMode ? '#d2dccd' : '#d5dde0');
  ambient.color.set(night ? '#6e8ba9' : '#ddeaf4'); ambient.intensity = night ? 0.3 : 0.35;
  hemi.color.set(night ? '#637fa6' : '#e0efff'); hemi.groundColor.set(night ? '#141e2d' : '#9fa9ad'); hemi.intensity = night ? 0.7 : 0.9;
  key.color.set(night ? '#a6c7ef' : '#fff4e6'); key.intensity = night ? 0.8 : 2.3;
  fill.intensity = night ? 0.45 : 0.8;
  renderer.toneMappingExposure = night ? 1.05 : 1.08;
  building.userData.setNight?.(night ? 1 : 0);
  renderer.shadowMap.needsUpdate = true;
  document.body.classList.toggle('night', night);
  document.querySelectorAll('[data-mode]').forEach(button => {
    button.setAttribute('aria-pressed', String((button.dataset.mode === 'night') === night));
  });
  invalidate();
}
function frameOptions(angle) {
  const rect = viewport.getBoundingClientRect();
  const width = coverMode ? rect.width : window.innerWidth, height = coverMode ? rect.height : window.innerHeight;
  if (coverMode) return zifengFrame({ size, width, height, angle, fov: camera.fov,
    top: 24, bottom: 32, side: 24, envelope: framingEnvelope });
  const toolbar = document.querySelector('.toolbar').getBoundingClientRect();
  const caption = document.querySelector('.caption').getBoundingClientRect();
  const top = width <= 650 ? caption.bottom + 14 : 24;
  // Reserve the measured toolbar, including wrapped rows on phones.
  const bottom = height - toolbar.top + 16;
  return zifengFrame({ size, width, height, angle, fov: camera.fov, top, bottom,
    side: Math.min(24, width * 0.06), orbitSafe: controls.autoRotate, envelope: framingEnvelope });
}
function updateViewport(angle) {
  const frame = frameOptions(angle);
  const rect = viewport.getBoundingClientRect();
  const width = coverMode ? rect.width : window.innerWidth, height = coverMode ? rect.height : window.innerHeight;
  camera.aspect = width / height;
  camera.setViewOffset(width, height, frame.offsetX, frame.offsetY, width, height);
  renderer.setSize(width, height);
  return frame;
}
function frameBuilding(angle = initialAngle, respectQuery = false) {
  const frame = updateViewport(angle);
  controls.target.copy(center);
  if (respectQuery) controls.target.y = queryNumber('ly', center.y);
  const distance = respectQuery ? Math.max(2, Math.min(100, queryNumber('r', frame.distance))) : frame.distance;
  controls.maxDistance = Math.max(100, frame.distance * 1.5);
  camera.position.copy(controls.target).addScaledVector(new THREE.Vector3(frame.direction.x, frame.direction.y, frame.direction.z), distance);
  camera.lookAt(controls.target); controls.update();
}
function resize() {
  if (viewport.clientWidth <= 0 || viewport.clientHeight <= 0) return;
  const angle = currentAngle();
  if (automaticFraming) frameBuilding(angle);
  else updateViewport(angle); // Never reset a user-chosen zoom or facade view.
  invalidate();
}
frameBuilding(initialAngle, true);
automaticFraming = !query.has('r') && !query.has('ly');
applyLighting();
for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => { night = button.dataset.mode === 'night'; applyLighting(); });
}
for (const button of document.querySelectorAll('[data-angle]')) {
  button.addEventListener('click', () => {
    const angle = Number(button.dataset.angle);
    setRotation(false); frameBuilding(angle); automaticFraming = true; updateDirectionButtons(angle);
  });
}
document.getElementById('rotate').addEventListener('click', () => setRotation(!controls.autoRotate));
document.getElementById('facade-detail').addEventListener('click', () => {
  setRotation(false); automaticFraming = false; updateDirectionButtons();
  const angle = 2.35, distance = 8;
  controls.target.copy(center).setY(8);
  camera.position.set(center.x + Math.cos(angle) * distance, 8 + distance * 0.12, center.z + Math.sin(angle) * distance);
  camera.lookAt(controls.target); controls.update();
});
document.getElementById('fit').addEventListener('click', () => {
  setRotation(false); frameBuilding(ZIFENG_COVER_VIEW.angle); automaticFraming = true; updateDirectionButtons();
});
controls.addEventListener('start', () => { automaticFraming = false; setRotation(false); updateDirectionButtons(); });
window.addEventListener('resize', resize);
function keydown(event) { if (event.key.toLowerCase() === 'n') { night = !night; applyLighting(); } }
window.addEventListener('keydown', keydown);
await renderer.compileAsync(scene, camera);
let renders = 0;
loop = createPreviewLoop({
  isAnimating: () => controls.autoRotate || night || cinematic.isAnimating,
  render(delta, elapsed) {
    controls.update(delta);
    const beacon = building.userData.beacon?.material;
    const opacity = beacon?.opacity;
    if (night) building.userData.tick?.(elapsed);
    if (!dirty && !controls.autoRotate && !cinematic.isAnimating && beacon?.opacity === opacity) return;
    // A finished entrance invalidates once to draw the native-resolution view.
    // Clear before rendering so that invalidation survives this frame.
    dirty = false;
    previewStatus.render(() => cinematic.render());
    if (++renders === 1) {
      document.getElementById('loading')?.remove();
      document.querySelectorAll('.toolbar button').forEach(button => { button.disabled = false; });
      if (query.has('diagnostics')) renderer.domElement.dataset.readyMs = String(Math.round(performance.now() - startedAt));
    }
    if (query.has('diagnostics')) {
      renderer.domElement.dataset.renders = String(renders);
      renderer.domElement.dataset.environments = String(environments.size);
    }
  },
});
bindPreviewLifecycle(loop, {
  onResume() { resize(); invalidate(); },
  onDispose() {
    cinematic.dispose();
    window.removeEventListener('resize', resize); window.removeEventListener('keydown', keydown); controls.dispose();
    disposePreviewScene(scene); environments.forEach(item => item.dispose()); renderer.dispose();
  },
});

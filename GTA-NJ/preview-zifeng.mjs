import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';
import { buildZifeng } from './js/zifeng.js';
import { LANDMARKS } from './js/data.js';
import { createPreviewLoop, createPreviewStatus, bindPreviewLifecycle, disposePreviewScene } from './js/preview-loop.js';

const previewStatus = createPreviewStatus();

const startedAt = performance.now();
const lm = LANDMARKS.find((landmark) => landmark.id === 'zifeng');
const building = buildZifeng(lm);
const scene = new THREE.Scene();
scene.add(building);

// Keep the individual building at the origin. Its model uses one common scale
// for plan and height, independent of the city map's geographic placement.
const bounds = new THREE.Box3().setFromObject(building);
const size = bounds.getSize(new THREE.Vector3());
const center = bounds.getCenter(new THREE.Vector3());
const camera = new THREE.PerspectiveCamera(38, 1, 0.05, 600);
const renderer = new THREE.WebGLRenderer({ antialias: true });
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.08;
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
// Architecture and lighting stay fixed while orbiting: reuse the shadow map.
renderer.shadowMap.autoUpdate = false;
document.body.appendChild(renderer.domElement);
renderer.domElement.setAttribute('aria-label', '紫峰大厦交互式三维模型');

const controls = new OrbitControls(camera, renderer.domElement);
// Apply drag deltas immediately; no easing lag or motion after release.
controls.enableDamping = false;
controls.rotateSpeed = 0.85;
controls.zoomSpeed = 0.65;
controls.panSpeed = 0.65;
controls.screenSpacePanning = true;
controls.minPolarAngle = 0.12;
controls.minDistance = 2;
controls.maxDistance = 100;
controls.maxPolarAngle = Math.PI * 0.49;
controls.autoRotateSpeed = 0.6;
controls.target.copy(center);
let loop;
let dirty = true;
const invalidate = () => { dirty = true; loop?.invalidate(); };
controls.addEventListener('change', invalidate);

// The large ground fades into the background; no visible platform edge or
// oversized horizon distracts from the silhouette.
const ground = new THREE.Mesh(
  new THREE.PlaneGeometry(2000, 2000),
  new THREE.MeshStandardMaterial({ color: '#d5dde0', roughness: 1 }),
);
ground.rotation.x = -Math.PI / 2;
ground.position.y = bounds.min.y - 0.014;
ground.receiveShadow = true;
scene.add(ground);
const ambient = new THREE.AmbientLight(0xddeaf4, 0.65);
const hemi = new THREE.HemisphereLight(0xe0efff, 0x9fa9ad, 1.7);
const key = new THREE.DirectionalLight(0xfff4e6, 2.8);
key.position.set(22, 38, 25);
key.castShadow = true;
key.target.position.copy(center);
key.shadow.mapSize.set(2048, 2048);
Object.assign(key.shadow.camera, { left: -12, right: 12, top: 12, bottom: -12, near: 1, far: 90 });
key.shadow.normalBias = 0.012;
key.shadow.bias = -0.00008;
scene.add(key.target);
const fill = new THREE.DirectionalLight(0xb9d4f1, 0.8);
fill.position.set(-24, 18, -18);
scene.add(ambient, hemi, key, fill);

// A soft sky plus large reflected light sources makes the glass legible from
// every angle. Separate environments retain cool, subdued night reflections.
const environments = new Map();
function makeEnvironment(night) {
  if (environments.has(night)) return environments.get(night);
  const pmrem = new THREE.PMREMGenerator(renderer);
  const environment = new THREE.Scene();
  const skyGeometry = new THREE.SphereGeometry(100, 32, 20);
  const position = skyGeometry.attributes.position;
  const colors = new Float32Array(position.count * 3);
  const sky = new THREE.Color(night ? '#364f70' : '#d8e9f5');
  const horizon = new THREE.Color(night ? '#162437' : '#aebabe');
  const color = new THREE.Color();
  for (let i = 0; i < position.count; i++) {
    const amount = THREE.MathUtils.clamp(position.getY(i) / 100 * 0.5 + 0.5, 0, 1);
    color.lerpColors(horizon, sky, Math.pow(amount, 0.65));
    color.toArray(colors, i * 3);
  }
  skyGeometry.setAttribute('color', new THREE.BufferAttribute(colors, 3));
  environment.add(new THREE.Mesh(skyGeometry, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide })));
  for (const [x, y, z, brightness] of [[-50, 30, -45, 2.8], [40, 55, 45, 4.0]]) {
    const light = new THREE.Mesh(
      new THREE.PlaneGeometry(30, 65),
      new THREE.MeshBasicMaterial({ color: new THREE.Color().setScalar(night ? brightness * 0.14 : brightness), side: THREE.DoubleSide }),
    );
    light.position.set(x, y, z);
    light.lookAt(0, 0, 0);
    environment.add(light);
  }
  const result = pmrem.fromScene(environment, 0.03);
  pmrem.dispose();
  environment.traverse((object) => {
    object.geometry?.dispose();
    object.material?.dispose();
  });
  environments.set(night, result);
  return result;
}

const query = new URLSearchParams(location.search);
function queryNumber(name, fallback) {
  const raw = query.get(name);
  const value = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isFinite(value) ? value : fallback;
}
const initialAngle = queryNumber('angle', 2.35);
let night = query.get('mode') === 'night';
let automaticFraming = true;

function updateDirectionButtons(angle = null) {
  document.querySelectorAll('[data-angle]').forEach((button) => {
    button.setAttribute('aria-pressed', String(angle !== null && Math.abs(Number(button.dataset.angle) - angle) < 0.001));
  });
}
function setRotation(enabled) {
  controls.autoRotate = enabled;
  document.getElementById('rotate').setAttribute('aria-pressed', String(enabled));
  if (enabled) updateDirectionButtons();
  invalidate();
}
function applyLighting() {
  const background = night ? '#101c2d' : '#e4ebef';
  scene.background = new THREE.Color(background);
  scene.fog = new THREE.Fog(background, 40, 115);
  scene.environment = makeEnvironment(night).texture;
  ground.material.color.set(night ? '#162335' : '#d5dde0');
  ambient.color.set(night ? '#6e8ba9' : '#ddeaf4');
  ambient.intensity = night ? 0.3 : 0.35;
  hemi.color.set(night ? '#637fa6' : '#e0efff');
  hemi.groundColor.set(night ? '#141e2d' : '#9fa9ad');
  hemi.intensity = night ? 0.7 : 0.9;
  key.color.set(night ? '#a6c7ef' : '#fff4e6');
  key.intensity = night ? 0.8 : 2.3;
  fill.intensity = night ? 0.45 : 0.8;
  renderer.toneMappingExposure = night ? 1.05 : 1.08;
  building.userData.setNight?.(night ? 1 : 0);
  renderer.shadowMap.needsUpdate = true;
  document.body.classList.toggle('night', night);
  document.querySelectorAll('[data-mode]').forEach((button) => {
    button.setAttribute('aria-pressed', String((button.dataset.mode === 'night') === night));
  });
  invalidate();
}

function fitDistance() {
  const verticalFov = THREE.MathUtils.degToRad(camera.fov);
  const horizontalFov = 2 * Math.atan(Math.tan(verticalFov / 2) * camera.aspect);
  // Reserve space for the controls on short/mobile screens. Bounding the
  // horizontal diagonal also keeps the podium visible at every azimuth.
  const horizontalExtent = Math.hypot(size.x, size.z);
  const verticalFit = size.y / (2 * Math.tan(verticalFov / 2));
  const horizontalFit = horizontalExtent / (2 * Math.tan(horizontalFov / 2));
  const toolbarHeight = document.querySelector('.toolbar').getBoundingClientRect().height;
  const usableHeight = Math.max(window.innerHeight * 0.45, window.innerHeight - toolbarHeight - 100);
  return Math.max(verticalFit * window.innerHeight / usableHeight, horizontalFit * 1.18) + horizontalExtent * 0.18;
}
function clearOrbitMomentum() {
  // Consume outstanding deltas before placing a preset camera.
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.enableDamping = damping;
}
function frameBuilding(angle = initialAngle, respectQuery = false) {
  clearOrbitMomentum();
  controls.target.copy(center);
  if (respectQuery) controls.target.y = queryNumber('ly', center.y);
  const distance = respectQuery ? THREE.MathUtils.clamp(queryNumber('r', fitDistance()), 2, 100) : fitDistance();
  camera.position.set(
    center.x + Math.cos(angle) * distance,
    controls.target.y + distance * 0.12,
    center.z + Math.sin(angle) * distance,
  );
  camera.lookAt(controls.target);
  controls.update();
}
function resize() {
  if (window.innerWidth <= 0 || window.innerHeight <= 0) return;
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
  if (automaticFraming) {
    const angle = Math.atan2(camera.position.z - controls.target.z, camera.position.x - controls.target.x);
    frameBuilding(angle);
  }
  invalidate();
}
// Set size before fitting, so both portrait and landscape start with the full
// spire and podium in view. Explicit query parameters remain useful for review.
camera.aspect = window.innerWidth / window.innerHeight;
camera.updateProjectionMatrix();
renderer.setSize(window.innerWidth, window.innerHeight);
frameBuilding(initialAngle, true);
automaticFraming = !query.has('r') && !query.has('ly');
applyLighting();

for (const button of document.querySelectorAll('[data-mode]')) {
  button.addEventListener('click', () => { night = button.dataset.mode === 'night'; applyLighting(); });
}
for (const button of document.querySelectorAll('[data-angle]')) {
  button.addEventListener('click', () => {
    const angle = Number(button.dataset.angle);
    setRotation(false);
    frameBuilding(angle);
    automaticFraming = true;
    updateDirectionButtons(angle);
  });
}
document.getElementById('rotate').addEventListener('click', () => setRotation(!controls.autoRotate));
document.getElementById('facade-detail').addEventListener('click', () => {
  setRotation(false);
  clearOrbitMomentum();
  automaticFraming = false;
  updateDirectionButtons();
  // Match the review camera: angle=2.35&r=8&ly=8 (240 m at 30 m/unit).
  const angle = 2.35, distance = 8;
  controls.target.copy(center).setY(8);
  camera.position.set(
    center.x + Math.cos(angle) * distance,
    controls.target.y + distance * 0.12,
    center.z + Math.sin(angle) * distance,
  );
  camera.lookAt(controls.target);
  controls.update();
});
document.getElementById('fit').addEventListener('click', () => {
  setRotation(false);
  frameBuilding();
  automaticFraming = true;
  updateDirectionButtons();
});
controls.addEventListener('start', () => {
  automaticFraming = false;
  setRotation(false);
  updateDirectionButtons();
});
window.addEventListener('resize', resize);
function keydown(event) {
  if (event.key.toLowerCase() === 'n') { night = !night; applyLighting(); }
}
window.addEventListener('keydown', keydown);
// Allow the driver to prepare shader programs before the first draw, instead
// of waiting for synchronous compilation in the first interaction frame.
await renderer.compileAsync(scene, camera);
let renders = 0;
loop = createPreviewLoop({
  isAnimating: () => controls.autoRotate || night,
  render(delta, elapsed) {
    controls.update(delta);
    const beacon = building.userData.beacon?.material;
    const opacity = beacon?.opacity;
    if (night) building.userData.tick?.(elapsed);
    // The night animation only changes the aviation beacon a few times per
    // cycle; do not redraw 159k triangles while its opacity stays the same.
    if (!dirty && !controls.autoRotate && beacon?.opacity === opacity) return;
    previewStatus.render(() => renderer.render(scene, camera));
    dirty = false;
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
    controls.dispose(); window.removeEventListener('resize', resize); window.removeEventListener('keydown', keydown);
    disposePreviewScene(scene); environments.forEach(item => item.dispose()); renderer.dispose();
  },
});

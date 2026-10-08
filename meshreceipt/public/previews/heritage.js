import { createCinematicTransition } from '/api/source/nanjing/js/preview-cinematic.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { HERITAGE } from './heritage-data.js';
import { mausoleumCoverFrame } from './heritage-framing.js';
import { createPreviewLoop, createPreviewStatus, bindPreviewLifecycle, disposePreviewScene } from '/api/source/nanjing/js/preview-loop.js';

const previewStatus = createPreviewStatus();

const requested = new URLSearchParams(location.search).get('asset');
const descriptor = Object.hasOwn(HERITAGE, requested) ? HERITAGE[requested] : null;
const $ = id => document.getElementById(id);

async function start() {
  if (!descriptor) throw new Error('未知组群；请选择明孝陵或中山陵。');
  $('title').textContent = descriptor.title; document.title = `${descriptor.title} · 琢信检视`;
  $('summary').textContent = descriptor.summary;
  const [{ BUILDERS }, { LANDMARKS }, { toV2 }, { terrainHeight }, { mergeStaticMeshes }] = await Promise.all([
    import('/api/source/nanjing/js/landmarks.js'), import('/api/source/nanjing/js/data.js'),
    import('/api/source/nanjing/js/geo.js'), import('/api/source/nanjing/js/world.js'),
    import('/api/source/nanjing/js/lib.js'),
  ]);
  const lm = LANDMARKS.find(item => item.id === requested);
  if (!lm || lm.model !== descriptor.model) throw new Error('来源构建器与组群目录不匹配。');
  const [x, z] = toV2(lm.lon, lm.lat), groundY = terrainHeight(x, z);
  const building = BUILDERS[lm.model](lm, { x, z, groundY });
  // Use the original procedural fallback; never label it an in-situ scan.
  const slots = building.userData.spiritSlots;
  if (slots && building.userData.spiritFallback) {
    for (const kind of ['lion', 'qilin']) {
      const slot = slots[kind]; if (!slot) continue;
      building.userData.spiritFallback(kind, -slot.x, slot.yW, slot.z, Math.PI / 2);
      building.userData.spiritFallback(kind, slot.x, slot.yE, slot.z, -Math.PI / 2);
    }
  }
  const scene = new THREE.Scene(); scene.background = new THREE.Color('#e4e7dc'); scene.add(building);
  building.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(building), center = bounds.getCenter(new THREE.Vector3());
  if (bounds.isEmpty() || !Number.isFinite(center.y)) throw new Error('来源模型为空或包含无效坐标。');
  const size = bounds.getSize(new THREE.Vector3());
  const coverBounds = new THREE.Box3();
  if (requested === 'zhongshanling') building.traverse(object => {
    if (!object.isMesh) return;
    const box = new THREE.Box3().setFromObject(object);
    // Memorial hall and its two front pillars; exclude the rear tomb and the
    // 720m approach so neither controls the cover camera's distance.
    if (box.max.z <= 0.55 && box.min.z >= -0.28 && box.max.y > 0.05) coverBounds.union(box);
  });
  // Keep the original framing, then batch this entirely static group before
  // uploading its geometry. Component viewpoints use coordinates, not meshes.
  if (requested === 'zhongshanling') mergeStaticMeshes(building);
  // Sample the existing source terrain, not a new measured reconstruction.
  const terrain = new THREE.PlaneGeometry(Math.max(size.x + 1.4, 3), size.z + 1.4, 24, 100).rotateX(-Math.PI / 2);
  const position = terrain.attributes.position;
  for (let i = 0; i < position.count; i++) {
    const px = position.getX(i) + center.x, pz = position.getZ(i) + center.z;
    position.setXYZ(i, px, terrainHeight(x + px, z + pz) - groundY - 0.05, pz);
  }
  terrain.computeVertexNormals();
  scene.add(new THREE.Mesh(terrain, new THREE.MeshStandardMaterial({ color: '#aeb995', roughness: 1, side: THREE.DoubleSide })));
  scene.add(new THREE.HemisphereLight(0xf6f8ed, 0x8e987b, 2.2));
  const light = new THREE.DirectionalLight(0xfff4dc, 2.4); light.position.set(-15, 25, 20); scene.add(light);
  const fill = new THREE.DirectionalLight(0xd7e2ea, 0.7); fill.position.set(20, 10, -15); scene.add(fill);
  const stage = $('viewport'), renderer = new THREE.WebGLRenderer({ antialias: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  stage.appendChild(renderer.domElement); renderer.domElement.setAttribute('aria-label', `${descriptor.title}交互式三维模型`);
  const camera = new THREE.PerspectiveCamera(40, 1, 0.03, 500);
  const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = false;
  controls.minDistance = 0.3; controls.maxDistance = 160; controls.autoRotateSpeed = 0.4;
  let loop, prepared = false, renders = 0;
  const invalidate = () => loop?.invalidate();
  controls.addEventListener('change', invalidate);
  const cinematic = createCinematicTransition({ renderer, scene, camera, controls, invalidate });
  let current = null, overhead = false, cover = requested === 'zhongshanling', manualCamera = false;
  function stopRotation() { controls.autoRotate = false; $('rotate').setAttribute('aria-pressed', 'false'); invalidate(); }
  function frame(part = current, top = overhead, useCover = cover) {
    current = part; overhead = top; cover = useCover; manualCamera = false;
    $('cover').setAttribute('aria-pressed', String(cover));
    if (cover && !coverBounds.isEmpty()) {
      const preset = mausoleumCoverFrame({ min: coverBounds.min.toArray(), max: coverBounds.max.toArray(),
        width: stage.clientWidth, height: stage.clientHeight, fov: camera.fov });
      camera.setViewOffset(stage.clientWidth, stage.clientHeight, 0, preset.offsetY, stage.clientWidth, stage.clientHeight);
      controls.target.fromArray(preset.target); camera.position.fromArray(preset.position);
      camera.lookAt(controls.target); controls.update();
      $('view-name').textContent = '封面视角 · 祭堂正面';
      $('status').textContent = '沿石阶中轴取景 · 来源模型预览';
      for (const button of $('parts').children) button.setAttribute('aria-pressed', 'false');
      return;
    }
    camera.clearViewOffset();
    const target = part ? new THREE.Vector3(0, terrainHeight(x, z + part.z) - groundY + 0.18, part.z) : center.clone();
    const span = part?.span ?? Math.max(size.x, size.z, size.y);
    const fit = 2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2) * Math.min(1, camera.aspect);
    const distance = span / fit * 1.2;
    const direction = top ? new THREE.Vector3(0.02, 1, 0.001) : new THREE.Vector3(0.65, 0.8, 1.15).normalize();
    controls.target.copy(target); camera.position.copy(target).addScaledVector(direction, distance);
    camera.lookAt(target); controls.update();
    $('view-name').textContent = part?.name ?? '全序列总览';
    $('status').textContent = part?.note ?? '来源模型预览 · 尚未验收';
    for (const button of $('parts').children) button.setAttribute('aria-pressed', String(button.dataset.name === (part?.name ?? '全序列总览')));
  }
  for (const part of [null, ...descriptor.components]) {
    const button = document.createElement('button'); button.textContent = part?.name ?? '全序列总览';
    button.dataset.name = button.textContent; button.setAttribute('aria-pressed', 'false');
    button.addEventListener('click', () => { stopRotation(); frame(part, false, false); }); $('parts').appendChild(button);
  }
  function resize() {
    const { width, height } = stage.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const previous = renderer.getSize(new THREE.Vector2());
    if (previous.x === width && previous.y === height) { invalidate(); return; }
    camera.aspect = Math.max(width, 1) / Math.max(height, 1); camera.updateProjectionMatrix(); renderer.setSize(width, height);
    if (!manualCamera) frame(); else invalidate();
  }
  $('cover').hidden = requested !== 'zhongshanling';
  $('cover').addEventListener('click', () => { stopRotation(); frame(null, false, true); });
  $('overview').addEventListener('click', () => { stopRotation(); frame(null, false, false); });
  $('top').addEventListener('click', () => { stopRotation(); frame(current, true, false); });
  $('rotate').addEventListener('click', () => { manualCamera = true; $('cover').setAttribute('aria-pressed', 'false'); controls.autoRotate = !controls.autoRotate; $('rotate').setAttribute('aria-pressed', String(controls.autoRotate)); invalidate(); });
  controls.addEventListener('start', () => { manualCamera = true; $('cover').setAttribute('aria-pressed', 'false'); stopRotation(); });
  window.addEventListener('resize', resize); resize();
  loop = createPreviewLoop({ isAnimating: () => controls.autoRotate || cinematic.isAnimating, render(delta) {
    if (!prepared) return;
    controls.update(delta); previewStatus.render(() => cinematic.render());
    if (new URLSearchParams(location.search).has('diagnostics')) renderer.domElement.dataset.renders = String(++renders);
  } });
  bindPreviewLifecycle(loop, { onResume: resize, onDispose() {
    cinematic.dispose();
    window.removeEventListener('resize', resize); controls.dispose(); disposePreviewScene(scene); renderer.dispose();
  } });
  await renderer.compileAsync(scene, camera);
  prepared = true; document.querySelectorAll('#controls button').forEach(button => { button.disabled = false; }); invalidate();
}

start().catch(error => { previewStatus.error(error); $('view-name').textContent = '预览未能加载'; $('error').textContent = error.message; $('status').textContent = '不能将加载失败计为验收通过'; });

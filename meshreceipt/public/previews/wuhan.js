import { createCinematicTransition } from '/api/source/nanjing/js/preview-cinematic.js';
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/OrbitControls.js';
import { WUHAN_TOWERS, HUANGHE_VERSIONS, huangheVersion, wuhanModelUrl } from './wuhan-data.js';
import { createLandscapeKit } from './landscape.js';
import { applyLatestPresentation } from './models/huanghe-glb/presentation.js';
import { normalizePreviewModel } from './model-space.js';
import { wuhanCoverFrame } from './wuhan-framing.js';
import { createPreviewLoop, createPreviewStatus, bindPreviewLifecycle, disposePreviewScene } from '/api/source/nanjing/js/preview-loop.js';

const previewStatus = createPreviewStatus();

const $ = id => document.getElementById(id);
const query = new URLSearchParams(location.search), requested = query.get('asset');
const isYellow = requested === 'huanghe';
const items = isYellow ? HUANGHE_VERSIONS : WUHAN_TOWERS;

async function start() {
  if (!['huanghe', 'wuhan-landmarks'].includes(requested)) throw new Error('未知武汉地标条目。');
  const title = isYellow ? '黄鹤楼' : '武汉地标建筑';
  $('title').textContent = title; document.title = `${title} · 琢信检视`;
  const initialVersion = isYellow ? huangheVersion(query.get('version') ?? undefined) : null;
  if (isYellow) { $('version-heading').hidden = false; $('parts').setAttribute('aria-label', '切换黄鹤楼模型版本'); }
  else $('summary').textContent = '五座原建筑接入城市铺装、街道与绿化。按原工程高度参数等比展示；环境和组合位置为展示设计，非真实街区复原。';
  const stage = $('viewport'), renderer = new THREE.WebGLRenderer({ antialias: true, logarithmicDepthBuffer: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.outputColorSpace = THREE.SRGBColorSpace; renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.05;
  renderer.shadowMap.enabled = true; renderer.shadowMap.type = THREE.PCFSoftShadowMap;
  renderer.shadowMap.autoUpdate = false;
  stage.appendChild(renderer.domElement);
  renderer.domElement.setAttribute('aria-label', `${title}交互式三维模型`);
  const landscape = createLandscapeKit(isYellow ? 'heritage' : 'modern');
  const scene = new THREE.Scene(); const sky = landscape.sky(); sky.colorSpace = THREE.SRGBColorSpace; scene.background = sky;
  scene.fog = new THREE.Fog('#e4e9de', 1500, 8000);
  scene.add(new THREE.HemisphereLight(0xdcebf0, 0x8b9376, 1.1));
  const key = new THREE.DirectionalLight(0xffe6c3, 2.1); key.castShadow = true;
  key.shadow.mapSize.set(2048, 2048); key.shadow.bias = -0.00006; key.shadow.normalBias = isYellow ? 0.06 : 0.22;
  scene.add(key, key.target);
  const fill = new THREE.DirectionalLight(0xd7e6ff, 0.4); fill.position.set(800, 600, -700); scene.add(fill);
  // Local studio environment gives metallic materials something to reflect; no CDN.
  const environment = new THREE.Scene(); environment.background = new THREE.Color('#d8e0d5');
  const panelGeometry = new THREE.BoxGeometry(1, 1, 1);
  for (const [x, y, z, sx, sy, sz, color] of [[-5, 5, 0, 1, 8, 8, '#ffffff'], [5, 2, -5, 2, 5, 5, '#b5c2b8'], [0, 8, 0, 12, 1, 12, '#ffffff']]) {
    const panel = new THREE.Mesh(panelGeometry, new THREE.MeshBasicMaterial({ color }));
    panel.position.set(x, y, z); panel.scale.set(sx, sy, sz); environment.add(panel);
  }
  const pmrem = new THREE.PMREMGenerator(renderer), envMap = pmrem.fromScene(environment, 0.04);
  scene.environment = envMap.texture; pmrem.dispose();
  environment.traverse(object => { object.material?.dispose(); }); panelGeometry.dispose();
  const camera = new THREE.PerspectiveCamera(38, 1, 0.1, 20000);
  const controls = new OrbitControls(camera, renderer.domElement);
  controls.enableDamping = false; controls.minDistance = isYellow ? 8 : 50; controls.maxDistance = 12000;
  controls.maxPolarAngle = Math.PI / 2 + 0.16;
  controls.autoRotateSpeed = 0.35;
  const group = new THREE.Group(); scene.add(group);
  const models = new Map(), failures = new Map(), labels = new Map();
  let activeId = initialVersion?.id ?? null, angle = 'cover', disposed = false;
  let followPreset = true, collectionSettled = isYellow;
  let continuousGround = null, groundKey = '';
  const loading = new Map(), glbScenes = new Map(); let loaderPromise;
  let loop;
  const invalidate = () => loop?.invalidate();
  controls.addEventListener('change', invalidate);
  const cinematic = createCinematicTransition({ renderer, scene, camera, controls, invalidate });

  function getLoader() {
    return loaderPromise ||= Promise.all([
      import('three/addons/GLTFLoader.js'), import('three/addons/meshopt_decoder.module.js'),
    ]).then(async ([{ GLTFLoader }, { MeshoptDecoder }]) => {
      await MeshoptDecoder.ready; return new GLTFLoader().setMeshoptDecoder(MeshoptDecoder);
    });
  }
  async function loadGLB(item) {
    const url = wuhanModelUrl(item);
    if (!glbScenes.has(url)) {
      const promise = getLoader().then(loader => loader.loadAsync(url)).then(gltf => gltf.scene);
      glbScenes.set(url, promise);
      promise.catch(() => glbScenes.delete(url));
    }
    // Geometry/textures may be shared, but each version owns its material state.
    const root = (await glbScenes.get(url)).clone(true);
    const materials = new Map();
    root.traverse(mesh => {
      if (!mesh.isMesh) return;
      const copy = material => { if (!materials.has(material)) materials.set(material, material.clone()); return materials.get(material); };
      mesh.material = Array.isArray(mesh.material) ? mesh.material.map(copy) : copy(mesh.material);
    });
    return root;
  }

  function stopRotation() { controls.autoRotate = false; $('rotate').setAttribute('aria-pressed', 'false'); invalidate(); }
  function layout() {
    let cursor = 0;
    for (const item of items) {
      const root = models.get(item.id); if (!root) continue;
      root.visible = activeId === null || activeId === item.id;
      if (!root.visible) continue;
      const plan = root.userData.landscape.userData.plan, plotWidth = plan.plot.maxX - plan.plot.minX;
      root.position.x = activeId === null && !isYellow ? cursor + plotWidth / 2 : 0;
      // Appending a later tower must not move already-visible buildings.
      root.position.z = activeId === null && !isYellow ? -plan.footprint.maxZ : 0;
      cursor += plotWidth;
    }
  }
  function modelBox(root) { return root.userData.modelBounds.clone().applyMatrix4(root.matrixWorld); }
  function updateGround() {
    const signature = `${activeId || 'all'}:${models.size}`;
    if (signature === groundKey) return;
    groundKey = signature;
    if (continuousGround) {
      scene.remove(continuousGround); continuousGround.traverse(mesh => mesh.geometry?.dispose()); continuousGround = null;
    }
    const groundBounds = new THREE.Box3(); let plan;
    for (const root of models.values()) if (root.visible) {
      plan = root.userData.landscape.userData.plan;
      const p = plan.plot;
      groundBounds.union(new THREE.Box3(new THREE.Vector3(p.minX, -0.4, p.minZ), new THREE.Vector3(p.maxX, 0, p.maxZ)).applyMatrix4(root.matrixWorld));
    }
    if (!groundBounds.isEmpty()) {
      continuousGround = landscape.createGround({ minX: groundBounds.min.x, maxX: groundBounds.max.x, minZ: groundBounds.min.z, maxZ: groundBounds.max.z }, plan);
      scene.add(continuousGround);
    }
  }
  function frame() {
    layout(); group.updateMatrixWorld(true);
    updateGround();
    const bounds = new THREE.Box3();
    for (const root of models.values()) if (root.visible) {
      bounds.union(modelBox(root));
    }
    if (bounds.isEmpty()) return;
    const center = bounds.getCenter(new THREE.Vector3()), size = bounds.getSize(new THREE.Vector3());
    if (followPreset) {
      const { width, height } = stage.getBoundingClientRect();
      if (width <= 0 || height <= 0) return;
      const preset = wuhanCoverFrame({ size, width, height, asset: requested, angle, fov: camera.fov });
      const direction = new THREE.Vector3(preset.direction.x, preset.direction.y, preset.direction.z);
      controls.target.copy(center); camera.position.copy(center).addScaledVector(direction, preset.distance);
      camera.setViewOffset(width, height, preset.offsetX, preset.offsetY, width, height);
      camera.lookAt(center); controls.update();
    }
    const distance = camera.position.distanceTo(center);
    camera.far = Math.max(2000, distance + size.length() * 6); camera.updateProjectionMatrix();
    const span = Math.max(size.x, size.y, size.z, 80);
    key.position.copy(center).add(new THREE.Vector3(-span * 0.6, span * 1.1, span * 0.7)); key.target.position.copy(center);
    const shadow = key.shadow.camera;
    shadow.left = shadow.bottom = -span * 0.85; shadow.right = shadow.top = span * 0.85;
    shadow.near = 1; shadow.far = span * 5; shadow.updateProjectionMatrix();
    scene.fog.near = distance + span * 0.65; scene.fog.far = distance + span * 3.5;
    renderer.shadowMap.needsUpdate = true; invalidate();
  }
  function selectAngle(next) {
    stopRotation(); angle = next; followPreset = true;
    stage.dataset.cameraView = next;
    for (const [id, value] of [['reset', 'cover'], ['front', 'front'], ['top', 'top']]) {
      $(id).setAttribute('aria-pressed', String(value === next));
    }
    frame();
  }
  function keepManualView() {
    followPreset = false; stage.dataset.cameraView = 'manual';
    for (const id of ['reset', 'front', 'top']) $(id).setAttribute('aria-pressed', 'false');
  }
  stage.dataset.cameraView = 'cover';
  function updateSource() {
    const item = items.find(item => item.id === activeId);
    $('source').replaceChildren();
    const attribution = document.createElement('span');
    attribution.textContent = isYellow ? item.attribution : '作者 Void · 原署名 CC-BY 4.0';
    $('source').append(attribution);
    if (item) {
      const link = document.createElement('a'); link.href = item.sourceUrl; link.target = '_blank'; link.rel = 'noopener';
      link.textContent = isYellow ? '此模型的版本与来源 ↗' : '此模型的上游出处 ↗'; $('source').append(link);
    }
    if (isYellow) {
      $('summary').textContent = item.description;
      $('attribution').href = item.sourceUrl; $('attribution').textContent = '当前版本与来源 ↗';
    }
  }
  function updateStatus() {
    const item = items.find(item => item.id === activeId);
    const available = item ? models.has(item.id) : models.size > 0;
    const complete = models.size === items.length;
    $('view-name').textContent = isYellow ? `黄鹤楼 · ${item.name}` : (item?.name || '五楼同屏 · 等比陈列');
    $('status').textContent = available
      ? `${isYellow ? '当前版本已载入' : item ? '单体模型已载入' : `${models.size}/${items.length} 模型已载入`}${!isYellow && !complete ? ' · 未齐全' : ''} · 未验收`
      : failures.has(activeId) ? '当前版本加载失败 · 未验收' : '正在载入所选模型 · 未验收';
    stage.setAttribute('aria-busy', String(!available && !failures.has(activeId)));
    document.querySelectorAll('#controls button').forEach(button => { button.disabled = !available; });
    $('retry').hidden = !isYellow || !failures.has(activeId);
    $('error').textContent = [...failures].filter(([id]) => !isYellow || id === activeId)
      .map(([id, message]) => `${items.find(item => item.id === id).name}：${message}`).join('；');
    for (const button of $('parts').children) {
      button.setAttribute('aria-pressed', String(button.dataset.id === (activeId ?? 'all')));
      const hint = button.querySelector('small');
      if (hint) hint.textContent = models.has(button.dataset.id) ? '已载入 · 可切换' : failures.has(button.dataset.id) ? '加载失败 · 可重试'
        : loading.has(button.dataset.id) ? '正在载入' : isYellow ? button.dataset.id === 'glb-latest' ? '默认 · 材质修正＋补件'
          : items.find(item => item.id === button.dataset.id)?.hint || '点选载入对比' : '正在载入';
    }
    updateSource();
  }
  for (const item of [...(isYellow ? [] : [{ id: 'all', name: '五楼同屏' }]), ...items]) {
    const button = document.createElement('button'); button.dataset.id = item.id; button.textContent = item.name;
    if (item.id !== 'all') { const hint = document.createElement('small'); hint.textContent = '正在载入'; button.append(hint); }
    button.addEventListener('click', () => {
      activeId = item.id === 'all' ? null : item.id; selectAngle('cover');
      if (isYellow) {
        const url = new URL(location.href); url.searchParams.set('version', item.id); history.replaceState(null, '', url);
        void loadItem(item);
      }
      frame(); updateStatus();
    });
    $('parts').append(button);
  }
  updateStatus();
  $('retry').addEventListener('click', () => { void loadItem(items.find(item => item.id === activeId)); });
  function resize() {
    const { width, height } = stage.getBoundingClientRect();
    if (width <= 0 || height <= 0) return;
    const previous = renderer.getSize(new THREE.Vector2());
    if (previous.x === width && previous.y === height) { invalidate(); return; }
    camera.aspect = Math.max(width, 1) / Math.max(height, 1);
    if (camera.view?.enabled) {
      const view = camera.view;
      camera.setViewOffset(width, height, view.offsetX * width / view.fullWidth, view.offsetY * height / view.fullHeight, width, height);
    }
    camera.updateProjectionMatrix(); renderer.setSize(width, height); frame();
  }
  $('reset').addEventListener('click', () => selectAngle('cover'));
  $('front').addEventListener('click', () => selectAngle('front'));
  $('top').addEventListener('click', () => selectAngle('top'));
  $('rotate').addEventListener('click', () => { keepManualView(); controls.autoRotate = !controls.autoRotate; $('rotate').setAttribute('aria-pressed', String(controls.autoRotate)); invalidate(); });
  controls.addEventListener('start', () => { keepManualView(); stopRotation(); }); window.addEventListener('resize', resize); resize();
  const projected = new THREE.Vector3(); let renders = 0;
  loop = createPreviewLoop({ isAnimating: () => controls.autoRotate || cinematic.isAnimating, render(delta) {
    controls.update(delta);
    // The panorama cover should reveal a complete row, not the first tower and
    // several automatic camera jumps. Explicit single-building views stay fast.
    const ready = (activeId !== null || collectionSettled) && [...models.values()].some(root => root.visible);
    previewStatus.render(() => cinematic.render(), ready);
    if (query.has('diagnostics')) renderer.domElement.dataset.renders = String(++renders);
    const width = stage.clientWidth, height = stage.clientHeight;
    for (const [id, label] of labels) {
      const root = models.get(id); const visible = root.visible && activeId === null;
      label.hidden = !visible; if (!visible) continue;
      projected.set(root.position.x, root.userData.displayHeight + 22, root.position.z).project(camera);
      label.hidden = projected.z < -1 || projected.z > 1;
      label.style.left = `${(projected.x + 1) / 2 * width}px`;
      label.style.top = `${(-projected.y + 1) / 2 * height}px`;
    }
  } });
  const lifecycle = bindPreviewLifecycle(loop, { onResume: resize, onDispose() {
    cinematic.dispose();
    disposed = true; window.removeEventListener('resize', resize); disposePreviewScene(scene);
    controls.dispose(); envMap.dispose(); sky.dispose(); landscape.dispose(); renderer.dispose();
  } });
  // Lazy-load only the selected yellow version. A late load never replaces the
  // current selection, and a failure never silently selects a different model.
  function loadItem(item) {
    if (disposed || models.has(item.id)) return Promise.resolve();
    if (loading.has(item.id)) return loading.get(item.id);
    failures.delete(item.id);
    const task = buildItem(item).finally(() => {
      loading.delete(item.id);
      if (!disposed) { frame(); updateStatus(); }
    });
    loading.set(item.id, task); updateStatus(); return task;
  }
  async function buildItem(item) {
    try {
      if (!await lifecycle.whenActive()) return;
      let root;
      if (item.kind === 'procedural') {
        const { buildYellowCraneTower } = await import(item.modulePath);
        root = buildYellowCraneTower({ stage: item.stage });
        if (root.userData.revision !== item.revision || root.userData.primaryRoofCount !== 5) throw new Error('代码模型版本或主檐数量不匹配');
      } else root = await loadGLB(item);
      if (disposed || !await lifecycle.whenActive()) return;
      const normalized = normalizePreviewModel(root, item);
      root.traverse(mesh => {
        if (!mesh.isMesh) return;
        mesh.castShadow = !mesh.name.startsWith('BackSide_'); mesh.receiveShadow = true;
        // These exports include same-winding FrontSide/BackSide duplicates. Render
        // the explicitly named reverse layer as a back face, not a black overlay.
        // This is a preview-only material correction; never rewrite the asset.
        if (!isYellow && mesh.name.startsWith('BackSide_')) {
          const reverse = material => { const copy = material.clone(); copy.side = THREE.BackSide; return copy; };
          mesh.material = Array.isArray(mesh.material) ? mesh.material.map(reverse) : reverse(mesh.material);
        }
        for (const material of Array.isArray(mesh.material) ? mesh.material : [mesh.material]) {
          if (material.map) material.map.anisotropy = Math.min(4, renderer.capabilities.getMaxAnisotropy());
        }
      });
      if (item.presentation) normalized.add(applyLatestPresentation(root, { maxAnisotropy: renderer.capabilities.getMaxAnisotropy() }));
      normalized.userData.modelBounds = new THREE.Box3().setFromObject(normalized);
      const foot = normalized.userData.modelBounds;
      const footprint = { minX: foot.min.x, maxX: foot.max.x, minZ: foot.min.z, maxZ: foot.max.z };
      const occupied = landscape.dressBase(root, footprint);
      const garden = landscape.createPlot(footprint, isYellow ? 'huanghe' : item.id, occupied);
      normalized.add(garden); normalized.userData.landscape = garden;
      normalized.visible = false; group.add(normalized);
      await renderer.compileAsync(normalized, camera, scene);
      if (disposed) return;
      normalized.visible = !isYellow || item.id === activeId;
      models.set(item.id, normalized);
      if (!isYellow) {
        const label = document.createElement('span'); label.className = 'building-label'; label.textContent = item.name;
        stage.append(label); labels.set(item.id, label);
      }
    } catch (error) {
      if (!disposed) {
        failures.set(item.id, `未能加载所选版本（${error.message}）`);
        if (item.id === activeId) previewStatus.error(error);
      }
    }
  }
  if (isYellow) await loadItem(initialVersion);
  else for (const item of items) {
    if (disposed) break;
    await loadItem(item);
    // Let the first models and controls paint before constructing the next plot.
    if (!disposed && await lifecycle.whenActive()) await new Promise(resolve => requestAnimationFrame(resolve));
  }
  collectionSettled = true; invalidate();
  if (!disposed && !models.size) previewStatus.error(new Error([...failures.values()].join('；') || '模型未能加载'));
}

start().catch(error => { previewStatus.error(error); $('error').textContent = error.message; $('view-name').textContent = '预览未能加载'; $('status').textContent = '加载失败不能计为验收通过'; });

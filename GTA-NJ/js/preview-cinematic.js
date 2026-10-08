import * as THREE from 'three';

// Original GPU composition: a live scene, a dissolving poster, and one
// instanced draw of flying image fragments. During the entrance, bounded HDR
// and transparent targets limit shading cost; the native drawing buffer never
// resizes. The real scene is freshly rendered on every animation frame.
const DURATION_MS = 1550;
const MAX_TEXTURE_SIDE = 1280;
const MAX_FRAGMENTS = 6912;
const fieldGLSL = `
float hash21(vec2 p) { return fract(sin(dot(p, vec2(127.1, 311.7))) * 43758.5453); }
float noise21(vec2 p) {
  vec2 i = floor(p), f = fract(p); f = f * f * (3.0 - 2.0 * f);
  return mix(mix(hash21(i), hash21(i + vec2(1., 0.)), f.x),
    mix(hash21(i + vec2(0., 1.)), hash21(i + vec2(1., 1.)), f.x), f.y);
}
float revealField(vec2 uv) {
  return uv.y * .58 + abs(uv.x - .5) * .24
    + noise21(uv * vec2(8., 11.)) * .15
    + hash21(floor(uv * grid)) * .085;
}
vec2 posterUv(vec2 uv) { return (uv * windowMap.zw + windowMap.xy - .5) * coverFit + .5; }
`;
const posterVertex = `varying vec2 vUv;
void main() { vUv = uv; gl_Position = vec4(position.xy, 0., 1.); }`;
const posterFragment = `
uniform sampler2D poster;
uniform float progress;
uniform vec2 grid, coverFit;
uniform vec4 windowMap;
varying vec2 vUv;
${fieldGLSL}
void main() {
  float sweep = mix(-.1, 1.15, progress);
  float field = revealField(vUv);
  float remaining = smoothstep(sweep - .025, sweep + .025, field);
  if (remaining < .001) discard;
  vec3 color = texture2D(poster, posterUv(vUv)).rgb;
  float edge = exp(-abs(field - sweep) * 58.0) * sin(progress * 3.14159265);
  vec2 cell = fract(vUv * grid);
  float line = 1.0 - smoothstep(.015, .05, min(min(cell.x, 1.-cell.x), min(cell.y, 1.-cell.y)));
  color = mix(color, vec3(.95, .65, .28), edge * (.18 + line * .44));
  gl_FragColor = vec4(color, remaining);
  #include <colorspace_fragment>
}`;
const fragmentVertex = `
uniform float progress, aspect;
uniform vec2 grid, coverFit;
uniform vec4 windowMap;
attribute vec2 origin;
attribute float seed;
varying vec2 imageUv, chipUv;
varying float alpha, gleam;
${fieldGLSL}
void main() {
  float sweep = mix(-.1, 1.15, progress);
  float age = (sweep - revealField(origin)) / .34;
  float travel = clamp(age, 0., 1.);
  float alive = step(0., age) * (1.0 - step(1., age));
  float curve = travel * travel;
  vec2 outward = vec2((origin.x - .5) * .8, .14 + seed * .20);
  vec2 drift = outward * curve + vec2(sin(seed * 39.), cos(seed * 27.)) * curve * .07;
  float angle = travel * (seed - .5) * 6.;
  mat2 rotation = mat2(cos(angle), -sin(angle), sin(angle), cos(angle));
  vec2 chip = rotation * (position.xy / grid) * mix(.72, .22, travel);
  chip.x *= mix(1., .18, sin(travel * 3.14159));
  // A perspective expansion brings the released pieces toward the viewer.
  float depth = 1.0 - curve * (.20 + seed * .22);
  vec2 xy = (origin * 2. - 1. + drift + chip) / depth;
  gl_Position = vec4(xy, 0., 1.);
  imageUv = posterUv(origin + uv / grid - .5 / grid);
  chipUv = uv;
  alpha = alive * smoothstep(0., .09, travel) * (1. - smoothstep(.45, 1., travel)) * .88;
  gleam = sin(travel * 3.14159265) * (.2 + seed * .55);
}`;
const fragmentFragment = `
uniform sampler2D poster;
varying vec2 imageUv, chipUv;
varying float alpha, gleam;
void main() {
  if (alpha < .001) discard;
  vec3 color = texture2D(poster, imageUv).rgb;
  float bevel = smoothstep(.32, .5, max(abs(chipUv.x-.5), abs(chipUv.y-.5)));
  color = mix(color, vec3(1., .72, .36), gleam * (.35 + bevel * .65));
  gl_FragColor = vec4(color, alpha);
  #include <colorspace_fragment>
}`;

const compositeFragment = `
uniform sampler2D sceneTexture, sceneDepth, effectTexture;
varying vec2 vUv;
void main() {
  // Render targets contain linear HDR scene color. Apply the renderer's tone
  // mapping only to the live model, before mixing in the authored poster.
  vec4 sceneColor = texture2D(sceneTexture, vUv);
  gl_FragColor = sceneColor;
  #include <tonemapping_fragment>
  // Three renders Color and SRGB texture backgrounds without tone mapping.
  // Their untouched depth is 1, so preserve that behavior at the boundary.
  float geometryPixel = 1. - step(.9999999, texture2D(sceneDepth, vUv).x);
  vec3 liveColor = mix(sceneColor.rgb, gl_FragColor.rgb, geometryPixel);
  vec4 cover = texture2D(effectTexture, vUv);
  // The transparent effect target contains premultiplied linear RGB.
  vec3 posterColor = cover.rgb / max(cover.a, .0001);
  gl_FragColor = vec4(mix(liveColor, posterColor, cover.a), 1.);
  #include <colorspace_fragment>
}`;

function createEffect(renderer, image) {
  const rect = renderer.domElement.getBoundingClientRect();
  const viewportWidth = Math.max(1, window.innerWidth), viewportHeight = Math.max(1, window.innerHeight);
  const width = Math.max(1, rect.width), height = Math.max(1, rect.height);
  const scale = Math.min(1, MAX_TEXTURE_SIDE / Math.max(image.naturalWidth, image.naturalHeight));
  const source = document.createElement('canvas');
  source.width = Math.max(1, Math.round(image.naturalWidth * scale));
  source.height = Math.max(1, Math.round(image.naturalHeight * scale));
  const context = source.getContext('2d', { alpha: false });
  if (!context) throw new Error('Poster decode canvas is unavailable');
  context.drawImage(image, 0, 0, source.width, source.height);
  const texture = new THREE.CanvasTexture(source);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.generateMipmaps = false;
  texture.minFilter = texture.magFilter = THREE.LinearFilter;
  const imageAspect = source.width / source.height, aspect = viewportWidth / viewportHeight;
  const columns = Math.min(108, Math.max(44, Math.round(width / 10)));
  const rows = Math.min(Math.floor(MAX_FRAGMENTS / columns), Math.max(36, Math.round(height / 10)));
  const uniforms = {
    poster: { value: texture }, progress: { value: 0 }, aspect: { value: width / height },
    grid: { value: new THREE.Vector2(columns, rows) },
    coverFit: { value: new THREE.Vector2(Math.min(1, aspect / imageAspect), Math.min(1, imageAspect / aspect)) },
    windowMap: { value: new THREE.Vector4(rect.left / viewportWidth,
      (viewportHeight - rect.bottom) / viewportHeight, width / viewportWidth, height / viewportHeight) },
  };
  const material = shader => new THREE.ShaderMaterial({ ...shader, uniforms,
    depthTest: false, depthWrite: false, transparent: true, toneMapped: false, side: THREE.DoubleSide });
  const layer = new THREE.Scene(), camera = new THREE.Camera();
  const posterGeometry = new THREE.PlaneGeometry(2, 2);
  const posterMaterial = material({ vertexShader: posterVertex, fragmentShader: posterFragment });
  const plane = new THREE.Mesh(posterGeometry, posterMaterial); plane.frustumCulled = false; plane.renderOrder = 1; layer.add(plane);
  const chipBase = new THREE.PlaneGeometry(2, 2), geometry = new THREE.InstancedBufferGeometry();
  geometry.index = chipBase.index.clone();
  for (const [name, attribute] of Object.entries(chipBase.attributes)) geometry.setAttribute(name, attribute.clone());
  chipBase.dispose();
  const count = columns * rows, origins = new Float32Array(count * 2), seeds = new Float32Array(count);
  for (let i = 0; i < count; i++) {
    origins[i * 2] = ((i % columns) + .5) / columns;
    origins[i * 2 + 1] = (Math.floor(i / columns) + .5) / rows;
    // Deterministic but decorrelated on the small grid; no per-frame CPU work.
    seeds[i] = Math.sin(i * 127.1 + 311.7) * 43758.5453 % 1;
    if (seeds[i] < 0) seeds[i] += 1;
  }
  geometry.setAttribute('origin', new THREE.InstancedBufferAttribute(origins, 2));
  geometry.setAttribute('seed', new THREE.InstancedBufferAttribute(seeds, 1));
  geometry.instanceCount = count;
  const chipsMaterial = material({ vertexShader: fragmentVertex, fragmentShader: fragmentFragment });
  const chips = new THREE.Mesh(geometry, chipsMaterial); chips.frustumCulled = false; chips.renderOrder = 2; layer.add(chips);
  const pixelRatio = Math.min(renderer.getPixelRatio(), 1, Math.sqrt(650000 / (width * height)));
  const target = new THREE.WebGLRenderTarget(Math.max(1, Math.floor(width * pixelRatio)), Math.max(1, Math.floor(height * pixelRatio)), {
    depthBuffer: false, stencilBuffer: false, minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  target.texture.colorSpace = THREE.LinearSRGBColorSpace;
  target.texture.generateMipmaps = false;
  const sceneTarget = new THREE.WebGLRenderTarget(target.width, target.height, {
    type: THREE.HalfFloatType, depthBuffer: true, stencilBuffer: false,
    minFilter: THREE.LinearFilter, magFilter: THREE.LinearFilter,
  });
  sceneTarget.depthTexture = new THREE.DepthTexture(target.width, target.height, THREE.UnsignedIntType);
  sceneTarget.depthTexture.minFilter = sceneTarget.depthTexture.magFilter = THREE.NearestFilter;
  sceneTarget.texture.colorSpace = THREE.LinearSRGBColorSpace;
  sceneTarget.texture.generateMipmaps = false;
  const composite = new THREE.Scene();
  const compositeMaterial = new THREE.ShaderMaterial({
    uniforms: { sceneTexture: { value: sceneTarget.texture }, sceneDepth: { value: sceneTarget.depthTexture }, effectTexture: { value: target.texture } },
    vertexShader: posterVertex, fragmentShader: compositeFragment,
    depthTest: false, depthWrite: false, transparent: false, toneMapped: true,
  });
  const copy = new THREE.Mesh(posterGeometry, compositeMaterial); copy.frustumCulled = false; composite.add(copy);
  return { layer, composite, target, sceneTarget, camera, uniforms, texture, count, pixelRatio, width: source.width, height: source.height,
    dispose() {
      geometry.dispose(); posterGeometry.dispose(); posterMaterial.dispose(); chipsMaterial.dispose();
      compositeMaterial.dispose(); target.dispose(); sceneTarget.dispose(); texture.dispose(); source.width = source.height = 1;
    } };

}

const percentile = (values, p) => {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return Math.round(sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * p) - 1)] * 100) / 100;
};

export function createCinematicTransition({ renderer, scene, camera, controls, invalidate }) {
  let active = null, disposed = false;
  const canvas = renderer.domElement;
  const root = document.documentElement;
  const savedViewport = new THREE.Vector4(), savedScissor = new THREE.Vector4(), savedClearColor = new THREE.Color();
  const style = document.createElement('style');
  style.textContent = `html[data-cinematic="running"] :is(.caption,.toolbar,#view-name,#controls,#status,#scale,#accuracy,body>header,.building-label){opacity:0!important;pointer-events:none!important} :is(.caption,.toolbar,#view-name,#controls,#status,#scale,#accuracy,body>header,.building-label){transition:opacity 220ms ease}`;
  document.head.appendChild(style);
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');
  function publish(request, status, metrics, reason) {
    if (window.parent !== window) window.parent.postMessage({ type: 'meshreceipt-cinematic-status',
      requestId: request.id, status, ...(metrics ? { metrics } : {}), ...(reason ? { reason } : {}) }, location.origin);
  }
  function finish(status = 'skipped', reason = 'cancelled') {
    const request = active;
    if (!request) return;
    active = null;
    request.cancelImage?.();
    const end = performance.now();
    const metrics = { frames: request.frames, durationMs: request.startedAt === null ? 0 : Math.round(end - request.startedAt),
      p50Ms: percentile(request.intervals, .5), p95Ms: percentile(request.intervals, .95), maxMs: percentile(request.intervals, 1),
      longFrames: request.intervals.filter(interval => interval > 50).length,
      viewportWidth: canvas.clientWidth, viewportHeight: canvas.clientHeight, rendererPixelRatio: renderer.getPixelRatio(),
      effectPixelRatio: request.effect?.pixelRatio ?? renderer.getPixelRatio(),
      effectWidth: request.effect?.target.width || 0, effectHeight: request.effect?.target.height || 0,
      sceneWidth: request.effect?.sceneTarget.width || 0, sceneHeight: request.effect?.sceneTarget.height || 0,
      renderCpuP95Ms: percentile(request.cpu, .95), renderCpuMaxMs: percentile(request.cpu, 1),
      drawCalls: request.drawCalls, fragments: request.effect?.count || 0,
      warmupMs: Math.round(request.warmupMs * 100) / 100,
      textureWidth: request.effect?.width || 0, textureHeight: request.effect?.height || 0 };
    if (request.saved) {
      camera.position.copy(request.saved.position); camera.quaternion.copy(request.saved.quaternion);
      controls.target.copy(request.saved.target); controls.enabled = request.saved.enabled;
      controls.autoRotate = request.saved.autoRotate; camera.updateMatrixWorld();
    }
    const restoreStart = performance.now();
    request.effect?.dispose(); delete root.dataset.cinematic;
    metrics.restoreCpuMs = Math.round((performance.now() - restoreStart) * 100) / 100;
    metrics.restoredPixelRatio = renderer.getPixelRatio();
    metrics.resourcesBefore = request.resourcesBefore;
    metrics.resourcesAfter = { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures };
    canvas.dataset.cinematicMetrics = JSON.stringify({ ...metrics, status, reason, requestId: request.id });
    canvas.dataset.cinematicFrames = String(metrics.frames);
    canvas.dataset.cinematicP95Ms = String(metrics.p95Ms);
    canvas.dataset.cinematicMaxMs = String(metrics.maxMs);
    canvas.dataset.cinematicDurationMs = String(metrics.durationMs);
    canvas.dataset.cinematicDrawCalls = String(metrics.drawCalls);
    publish(request, status, metrics, reason); invalidate();
  }
  async function play(data) {
    if (active?.id === data.requestId) return;
    finish('skipped', 'superseded');
    const request = { id: data.requestId, frames: 0, intervals: [], cpu: [], drawCalls: 0,
      effect: null, saved: null, warmed: false, warmupMs: 0, startedAt: null, previous: null,
      resourcesBefore: { geometries: renderer.info.memory.geometries, textures: renderer.info.memory.textures } };
    active = request;
    if (disposed || reducedMotion.matches || document.hidden || renderer.getContext().isContextLost()) {
      finish('skipped', reducedMotion.matches ? 'reduced-motion' : 'unavailable'); return;
    }
    const hdrSupported = renderer.capabilities.isWebGL2
      ? renderer.extensions.has('EXT_color_buffer_float')
      : renderer.extensions.has('EXT_color_buffer_half_float') && renderer.extensions.has('OES_texture_half_float')
        && renderer.extensions.has('OES_texture_half_float_linear') && renderer.extensions.has('WEBGL_depth_texture');
    if (!hdrSupported) { finish('skipped', 'hdr-unavailable'); return; }
    let url;
    try { url = new URL(data.poster, location.href); } catch { finish('skipped', 'invalid-poster'); return; }
    if (url.origin !== location.origin || !['http:', 'https:'].includes(url.protocol)) { finish('skipped', 'invalid-poster'); return; }
    root.dataset.cinematic = 'preparing';
    let effect = null;
    try {
      const image = await new Promise((resolve, reject) => {
        const img = new Image();
        const timeout = setTimeout(() => reject(new Error('Poster load timed out')), 5000);
        const cleanup = () => { clearTimeout(timeout); img.onload = img.onerror = null; request.cancelImage = null; };
        request.cancelImage = () => { cleanup(); img.src = ''; reject(new Error('Transition cancelled')); };
        img.onload = () => { cleanup(); resolve(img); };
        img.onerror = () => { cleanup(); reject(new Error('Poster unavailable')); };
        img.src = url.href;
      });
      if (active !== request) return;
      effect = createEffect(renderer, image);
      renderer.initTexture(effect.texture);
      const previousTarget = renderer.getRenderTarget();
      let layerCompile, sceneCompile;
      try {
        renderer.setRenderTarget(effect.sceneTarget);
        const gl = renderer.getContext();
        if (gl.checkFramebufferStatus(gl.FRAMEBUFFER) !== gl.FRAMEBUFFER_COMPLETE) throw new Error('HDR target is unavailable');
        sceneCompile = renderer.compileAsync(scene, camera);
        renderer.setRenderTarget(effect.target);
        layerCompile = renderer.compileAsync(effect.layer, effect.camera);
      } finally { renderer.setRenderTarget(previousTarget); }
      await Promise.all([sceneCompile, layerCompile, renderer.compileAsync(effect.composite, effect.camera)]);
      if (active !== request || disposed) { effect.dispose(); return; }
      request.effect = effect;
      request.saved = { position: camera.position.clone(), quaternion: camera.quaternion.clone(),
        target: controls.target.clone(), enabled: controls.enabled, autoRotate: controls.autoRotate };
      controls.enabled = false; controls.autoRotate = false;
      request.offset = request.saved.position.clone().sub(request.saved.target);
      root.dataset.cinematic = 'running'; invalidate();
    } catch {
      if (effect && request.effect !== effect) effect.dispose();
      if (active === request) finish('skipped', 'preparation-failed');
    }
  }
  function message(event) {
    if (event.source !== window.parent || event.origin !== location.origin) return;
    const data = event.data;
    if (data?.type === 'meshreceipt-preview-visibility' && data.active === false) { finish('skipped', 'hidden'); return; }
    if (data?.type !== 'meshreceipt-cinematic' || typeof data.requestId !== 'string') return;
    if (data.action === 'skip' && active?.id === data.requestId) finish('skipped', 'user-skip');
    else if (data.action === 'play' && typeof data.poster === 'string') void play(data);
  }
  function interaction() { finish('skipped', 'interaction'); }
  function resize() { finish('skipped', 'resize'); }
  function hidden() { if (document.hidden) finish('skipped', 'hidden'); }
  function pagehide() { finish('skipped', 'pagehide'); }
  function contextlost() { finish('skipped', 'context-lost'); }
  function motionChanged() { if (reducedMotion.matches) finish('skipped', 'reduced-motion'); }
  window.addEventListener('message', message);
  window.addEventListener('resize', resize, true);
  window.addEventListener('pagehide', pagehide);
  document.addEventListener('visibilitychange', hidden);
  document.addEventListener('pointerdown', interaction, true);
  document.addEventListener('wheel', interaction, { capture: true, passive: true });
  document.addEventListener('keydown', interaction, true);
  canvas.addEventListener('webglcontextlost', contextlost);
  reducedMotion.addEventListener('change', motionChanged);
  return {
    get isAnimating() { return Boolean(active?.effect); },
    render() {
      const request = active, effect = request?.effect;
      if (!effect) { renderer.render(scene, camera); return; }
      const now = performance.now(), start = now;
      if (request.warmed) {
        if (request.startedAt === null) request.startedAt = now;
        else if (request.intervals.length < 240) request.intervals.push(now - request.previous);
        request.previous = now;
      }
      const progress = request.startedAt === null ? 0 : Math.min(1, (now - request.startedAt) / DURATION_MS);
      // Ease out a restrained camera push, ending at the exact cached pose.
      camera.position.copy(request.saved.target).addScaledVector(request.offset, 1 + .04 * Math.pow(1 - progress, 3));
      camera.quaternion.copy(request.saved.quaternion); camera.updateMatrixWorld();
      effect.uniforms.progress.value = progress;
      const autoClear = renderer.autoClear;
      const previousTarget = renderer.getRenderTarget();
      renderer.getViewport(savedViewport); renderer.getScissor(savedScissor); renderer.getClearColor(savedClearColor);
      const clearAlpha = renderer.getClearAlpha(), scissorTest = renderer.getScissorTest();
      const restoreState = () => {
        renderer.setRenderTarget(previousTarget); renderer.setViewport(savedViewport);
        renderer.setScissor(savedScissor); renderer.setScissorTest(scissorTest);
        renderer.setClearColor(savedClearColor, clearAlpha); renderer.autoClear = autoClear;
      };
      try {
        renderer.setRenderTarget(effect.sceneTarget); renderer.setScissorTest(false); renderer.autoClear = true;
        renderer.render(scene, camera);
        const sceneCalls = renderer.info.render.calls;
        renderer.autoClear = false; renderer.setRenderTarget(effect.target);
        renderer.setScissorTest(false); renderer.setClearColor(0x000000, 0); renderer.clear(true, false, false);
        renderer.render(effect.layer, effect.camera);
        const effectCalls = renderer.info.render.calls;
        restoreState(); renderer.autoClear = false;
        renderer.render(effect.composite, effect.camera);
        request.drawCalls = Math.max(request.drawCalls, sceneCalls + effectCalls + renderer.info.render.calls);
      } catch {
        restoreState(); finish('skipped', 'render-failed');
        renderer.render(scene, camera); return;
      } finally { restoreState(); }
      if (!request.warmed) {
        // Linking is not the entire driver cost: the first instanced draw may
        // still upload VAOs/program state. Exercise it behind the parent cover
        // and begin the visible clock on the following animation frame.
        request.warmed = true; request.warmupMs = performance.now() - start;
        invalidate(); return;
      }
      request.frames++;
      if (request.cpu.length < 240) request.cpu.push(performance.now() - start);
      // The parent drops its loading cover only after this actual special draw.
      if (request.frames === 1) publish(request, 'started');
      if (progress >= 1) finish('complete', 'finished');
    },
    dispose() {
      if (disposed) return;
      disposed = true; finish('skipped', 'disposed'); style.remove();
      window.removeEventListener('message', message); window.removeEventListener('resize', resize, true);
      window.removeEventListener('pagehide', pagehide); document.removeEventListener('visibilitychange', hidden);
      document.removeEventListener('pointerdown', interaction, true); document.removeEventListener('wheel', interaction, true);
      document.removeEventListener('keydown', interaction, true); canvas.removeEventListener('webglcontextlost', contextlost);
      reducedMotion.removeEventListener('change', motionChanged);
    },
  };
}

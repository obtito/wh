import test from 'node:test';
import assert from 'node:assert/strict';
import { registerHooks } from 'node:module';

// Exercise the browser module with its deployed r160 types; GPU calls are
// recorded instead of requiring a headless WebGL implementation.
const threeUrl = new URL('../../GTA-NJ/vendor/three.module.js', import.meta.url).href;
const hooks = registerHooks({ resolve(specifier, context, next) {
  return specifier === 'three' ? { url: threeUrl, shortCircuit: true } : next(specifier, context);
} });
const THREE = await import(threeUrl);
const { createCinematicTransition } = await import('../../GTA-NJ/js/preview-cinematic.js');
hooks.deregister();

function eventTarget() {
  const listeners = new Map();
  return {
    addEventListener(type, callback) {
      if (!listeners.has(type)) listeners.set(type, new Set());
      listeners.get(type).add(callback);
    },
    removeEventListener(type, callback) { listeners.get(type)?.delete(callback); },
    emit(type, event = {}) { for (const callback of [...listeners.get(type) || []]) callback(event); },
    listenerCount() { return [...listeners.values()].reduce((sum, set) => sum + set.size, 0); },
  };
}
const flush = async () => { for (let i = 0; i < 6; i++) await Promise.resolve(); };

function fixture(t, { reduced = false, deferredCompile = false } = {}) {
  const savedGlobals = new Map(['window', 'document', 'location', 'Image', 'performance']
    .map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  let clock = 0, pixelRatio = 2, invalidations = 0, currentTarget = null;
  const compileResolvers = [];
  const messages = [], images = [], draws = [], compiles = [], styles = [];
  const media = { ...eventTarget(), matches: reduced };
  const win = { ...eventTarget(), innerWidth: 1000, innerHeight: 600,
    matchMedia: () => media, parent: { postMessage(message, origin) { messages.push({ ...message, origin }); } } };
  const canvas = { ...eventTarget(), clientWidth: 1000, clientHeight: 600, dataset: {},
    getBoundingClientRect: () => ({ left: 0, bottom: 600, width: 1000, height: 600 }) };
  const doc = { ...eventTarget(), hidden: false, documentElement: { dataset: {} },
    head: { appendChild(style) { styles.push(style); } },
    createElement(tag) {
      if (tag === 'style') return { textContent: '', remove() { styles.splice(styles.indexOf(this), 1); } };
      assert.equal(tag, 'canvas');
      return { width: 0, height: 0, getContext: () => ({ drawImage() {} }) };
    } };
  class FakeImage {
    constructor() { this.naturalWidth = 1800; this.naturalHeight = 1200; images.push(this); }
    set src(value) { this.url = value; }
    get src() { return this.url; }
    load() { this.onload?.(); }
  }
  Object.assign(globalThis, { window: win, document: doc, Image: FakeImage,
    location: { origin: 'http://127.0.0.1:4318', href: 'http://127.0.0.1:4318/previews/example.html' } });
  Object.defineProperty(globalThis, 'performance', { configurable: true, value: { now: () => clock } });
  const memory = { geometries: 0, textures: 0 }, trackedGeometry = new Set(), trackedTargets = new Set();
  const viewport = new THREE.Vector4(11, 13, 500, 300), scissor = new THREE.Vector4(17, 19, 400, 250);
  const clearColor = new THREE.Color(0x123456); let clearAlpha = .4, scissorTest = true;
  const renderer = { domElement: canvas, autoClear: true, info: { memory, render: { calls: 0 } },
    capabilities: { isWebGL2: true }, extensions: { has: () => true },
    getPixelRatio: () => pixelRatio, setPixelRatio(value) { pixelRatio = value; },
    getContext: () => ({ isContextLost: () => false, FRAMEBUFFER: 36160,
      FRAMEBUFFER_COMPLETE: 36053, checkFramebufferStatus: () => 36053 }), clearDepth() {},
    getRenderTarget: () => currentTarget,
    setRenderTarget(target) {
      currentTarget = target;
      if (target && !trackedTargets.has(target)) {
        const ownedTextures = target.depthTexture ? 2 : 1;
        trackedTargets.add(target); memory.textures += ownedTextures;
        target.addEventListener('dispose', () => { trackedTargets.delete(target); memory.textures -= ownedTextures; });
      }
    },
    getViewport: output => output.copy(viewport), setViewport: value => viewport.copy(value),
    getScissor: output => output.copy(scissor), setScissor: value => scissor.copy(value),
    getClearColor: output => output.copy(clearColor), getClearAlpha: () => clearAlpha,
    setClearColor(color, alpha) { clearColor.set(color); clearAlpha = alpha; },
    getScissorTest: () => scissorTest, setScissorTest(value) { scissorTest = value; }, clear() {},
    initTexture(texture) {
      memory.textures++;
      texture.addEventListener('dispose', () => memory.textures--);
    },
    compileAsync(scene) {
      compiles.push({ scene, target: currentTarget });
      return deferredCompile ? new Promise(resolve => { compileResolvers.push(resolve); }) : Promise.resolve();
    },
    render(scene) {
      draws.push({ scene, autoClear: this.autoClear, pixelRatio, target: currentTarget });
      let count = 0;
      scene.traverse(object => {
        if (!object.geometry) return;
        count++;
        if (trackedGeometry.has(object.geometry)) return;
        trackedGeometry.add(object.geometry); memory.geometries++;
        object.geometry.addEventListener('dispose', () => { trackedGeometry.delete(object.geometry); memory.geometries--; });
      });
      this.info.render.calls = count;
    } };
  const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera();
  camera.position.set(3, 2, 10); camera.lookAt(0, 1, 0);
  const controls = { target: new THREE.Vector3(0, 1, 0), enabled: true, autoRotate: true };
  const original = { position: camera.position.clone(), quaternion: camera.quaternion.clone(), target: controls.target.clone() };
  const transition = createCinematicTransition({ renderer, scene, camera, controls, invalidate() { invalidations++; } });
  t.after(() => {
    transition.dispose();
    for (const [key, descriptor] of savedGlobals) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete globalThis[key];
    }
  });
  const send = (data, overrides = {}) => win.emit('message', { source: win.parent, origin: location.origin, data, ...overrides });
  return { transition, renderer, scene, camera, controls, original, messages, images, draws, compiles, styles, media, win, doc, canvas, memory,
    send, play(id = 'one', poster = '/previews/cover.webp') { send({ type: 'meshreceipt-cinematic', action: 'play', requestId: id, poster }); },
    skip(id = 'one') { send({ type: 'meshreceipt-cinematic', action: 'skip', requestId: id }); },
    tick(value) { clock = value; transition.render(); }, resolveCompile() { compileResolvers.forEach(resolve => resolve()); },
    assertRendererState() {
      assert.equal(renderer.getRenderTarget(), null); assert.equal(renderer.getPixelRatio(), 2);
      assert.deepEqual(viewport.toArray(), [11, 13, 500, 300]); assert.deepEqual(scissor.toArray(), [17, 19, 400, 250]);
      assert.equal(clearColor.getHex(), 0x123456); assert.equal(clearAlpha, .4); assert.equal(scissorTest, true);
      assert.equal(renderer.autoClear, true);
    },
    get invalidations() { return invalidations; } };
}

test('only the same-origin parent may start playback; external posters allocate nothing', async t => {
  const f = fixture(t), command = { type: 'meshreceipt-cinematic', action: 'play', requestId: 'one', poster: '/cover.webp' };
  f.send(command, { source: {} }); f.send(command, { origin: 'https://other.example' });
  assert.equal(f.images.length, 0); assert.equal(f.messages.length, 0);
  f.play('external', 'https://other.example/cover.webp'); await flush();
  assert.equal(f.images.length, 0); assert.equal(f.memory.textures, 0);
  assert.equal(f.messages.at(-1).reason, 'invalid-poster');
});

test('reduced motion skips before image decode or GPU allocation', t => {
  const f = fixture(t, { reduced: true }); f.play();
  assert.equal(f.messages.at(-1).status, 'skipped');
  assert.equal(f.messages.at(-1).reason, 'reduced-motion');
  assert.equal(f.images.length, 0); assert.equal(f.draws.length, 0);
  assert.equal(f.memory.textures, 0); assert.equal(f.transition.isAnimating, false);
});

test('skip cancels a pending image and its late completion cannot start playback', async t => {
  const f = fixture(t); f.play();
  const image = f.images[0], lateOnload = image.onload;
  f.skip('unrelated'); assert.notEqual(image.src, '');
  f.skip(); assert.equal(image.src, ''); assert.equal(image.onload, null);
  lateOnload(); await flush();
  assert.equal(f.transition.isAnimating, false); assert.equal(f.memory.textures, 0);
  assert.deepEqual(f.messages.map(message => message.status), ['skipped']);
  assert.equal(f.doc.documentElement.dataset.cinematic, undefined);
});

test('superseding a pending image cannot let the old request finish the new one', async t => {
  const f = fixture(t); f.play('old'); const lateOnload = f.images[0].onload;
  f.play('new'); lateOnload(); f.images[1].load(); await flush();
  assert.equal(f.transition.isAnimating, true);
  assert.deepEqual(f.messages.map(message => [message.requestId, message.reason]), [['old', 'superseded']]);
  f.skip('old'); assert.equal(f.transition.isAnimating, true);
  f.skip('new'); assert.equal(f.transition.isAnimating, false);
  assert.equal(f.memory.textures, 0); assert.equal(f.renderer.getPixelRatio(), 2);
});

test('disposal during shader preparation releases late resources and removes listeners', async t => {
  const f = fixture(t, { deferredCompile: true }); f.play(); f.images[0].load(); await flush();
  assert.ok(f.memory.textures > 0, 'preparation owns textures until its pending compiles settle');
  f.transition.dispose(); f.resolveCompile(); await flush();
  assert.equal(f.memory.textures, 0); assert.equal(f.memory.geometries, 0);
  assert.equal(f.messages.at(-1).reason, 'disposed');
  assert.equal(f.messages.some(message => message.status === 'started'), false);
  assert.equal(f.win.listenerCount() + f.doc.listenerCount() + f.canvas.listenerCount() + f.media.listenerCount(), 0);
  assert.equal(f.styles.length, 0);
  const count = f.messages.length; f.play('after-dispose'); assert.equal(f.messages.length, count);
});

test('warmup stays covered; every draw preserves renderer state and completion releases owned resources', async t => {
  const f = fixture(t); f.play(); f.images[0].load(); await flush();
  assert.equal(f.transition.isAnimating, true); assert.equal(f.controls.enabled, false);
  f.assertRendererState();
  f.tick(0); assert.equal(f.messages.length, 0, 'driver warmup must not signal visible playback');
  f.tick(16); assert.equal(f.messages.at(-1).status, 'started');
  assert.equal(f.draws[0].scene, f.scene); assert.equal(f.draws[1].autoClear, false);
  f.assertRendererState();
  f.tick(1616);
  assert.equal(f.messages.at(-1).status, 'complete'); assert.equal(f.transition.isAnimating, false);
  assert.ok(f.camera.position.equals(f.original.position)); assert.ok(f.camera.quaternion.equals(f.original.quaternion));
  assert.ok(f.controls.target.equals(f.original.target));
  assert.equal(f.controls.enabled, true); assert.equal(f.controls.autoRotate, true);
  f.assertRendererState();
  assert.equal(f.memory.textures, 0); assert.equal(f.memory.geometries, 0);
  const liveDraws = f.draws.filter(draw => draw.scene === f.scene);
  assert.equal(liveDraws.length, 3, 'the model must render on every cinematic frame, never reuse a snapshot');
  for (const draw of liveDraws) {
    assert.equal(draw.pixelRatio, 2, 'the native drawing buffer must never be resized');
    assert.equal(draw.target?.texture.type, THREE.HalfFloatType, 'live HDR highlights must survive the temporary target');
    assert.equal(draw.target?.texture.colorSpace, THREE.LinearSRGBColorSpace);
    assert.ok(draw.target?.depthTexture, 'background pixels need depth to preserve their original tone-mapping behavior');
  }
  assert.ok(f.compiles.some(compile => compile.scene === f.scene && compile.target === liveDraws[0].target),
    'prepare the model shader variant for the same HDR target used by the animation');
  f.tick(1632);
  assert.equal(f.draws.at(-1).scene, f.scene); assert.equal(f.draws.at(-1).target, null,
    'completed playback must return to native rendering without temporary targets');
});

test('motion preference changes and parent hiding stop active playback immediately', async t => {
  const f = fixture(t); f.play(); f.images[0].load(); await flush(); f.tick(0); f.tick(16);
  f.media.matches = true; f.media.emit('change');
  assert.equal(f.messages.at(-1).reason, 'reduced-motion'); assert.equal(f.transition.isAnimating, false);
  f.media.matches = false; f.play('second'); f.images[1].load(); await flush();
  f.send({ type: 'meshreceipt-preview-visibility', active: false });
  assert.equal(f.messages.at(-1).reason, 'hidden'); assert.equal(f.controls.enabled, true);
  assert.equal(f.memory.textures, 0); assert.equal(f.renderer.getPixelRatio(), 2);
});

test('an effect draw failure restores renderer state and exposes the native model', async t => {
  const f = fixture(t); f.play(); f.images[0].load(); await flush();
  const render = f.renderer.render.bind(f.renderer); let failOnce = true;
  f.renderer.render = scene => {
    if (scene !== f.scene && failOnce) { failOnce = false; throw new Error('simulated effect draw failure'); }
    render(scene);
  };
  assert.doesNotThrow(() => f.tick(0));
  f.assertRendererState();
  assert.equal(f.messages.at(-1).reason, 'render-failed'); assert.equal(f.transition.isAnimating, false);
  assert.equal(f.controls.enabled, true); assert.equal(f.draws.at(-1).scene, f.scene);
  assert.equal(f.memory.textures, 0); assert.equal(f.memory.geometries, 0);
});

test('unsupported HDR devices skip before decoding or allocating the transition', t => {
  const f = fixture(t); f.renderer.extensions.has = () => false; f.play();
  assert.equal(f.messages.at(-1).reason, 'hdr-unavailable'); assert.equal(f.transition.isAnimating, false);
  assert.equal(f.images.length, 0); assert.equal(f.memory.textures, 0); f.assertRendererState();
});

test('an incomplete framebuffer fails safely and releases partially prepared resources', async t => {
  const f = fixture(t), getContext = f.renderer.getContext;
  f.renderer.getContext = () => ({ ...getContext(), checkFramebufferStatus: () => 36054 });
  f.play(); f.images[0].load(); await flush();
  assert.equal(f.messages.at(-1).reason, 'preparation-failed'); assert.equal(f.transition.isAnimating, false);
  assert.equal(f.memory.textures, 0); assert.equal(f.memory.geometries, 0);
  assert.equal(f.compiles.length, 0); f.assertRendererState();
});

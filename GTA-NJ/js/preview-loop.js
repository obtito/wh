// Coalesce pointer/resize updates into one frame. Static previews have no idle
// WebGL work; animated views resume without accumulating time while hidden.
export function createPreviewLoop({
  render, isAnimating,
  isVisible = () => document.visibilityState !== 'hidden',
  requestFrame = callback => requestAnimationFrame(callback),
  cancelFrame = id => cancelAnimationFrame(id),
}) {
  let pending = null, paused = false, disposed = false, previous = null, elapsed = 0;
  function invalidate() {
    if (pending === null && !paused && !disposed && isVisible()) pending = requestFrame(frame);
  }
  function frame(time) {
    pending = null;
    if (paused || disposed || !isVisible()) { previous = null; return; }
    const delta = previous === null ? 0 : Math.min(Math.max(0, (time - previous) / 1000), 0.1);
    previous = time;
    elapsed += delta;
    render(delta, elapsed);
    if (isAnimating()) invalidate();
    else previous = null;
  }
  function pause() {
    paused = true;
    if (pending !== null) cancelFrame(pending);
    pending = previous = null;
  }
  return {
    invalidate, pause,
    resume() { if (!disposed) { paused = false; previous = null; invalidate(); } },
    dispose() { pause(); disposed = true; },
  };
}

// The lifecycle handshake only says that the frame can receive
// visibility messages. Reveal the interactive preview after its first model
// draw succeeds, not after dependencies load or an empty background paints.
export function createPreviewStatus({ windowTarget = window } = {}) {
  let status = null, lastError = null;
  function publish(next, message) {
    if (status === 'ready' || (status === next && message === lastError)) return;
    status = next; lastError = message;
    if (windowTarget.parent !== windowTarget) windowTarget.parent.postMessage({
      type: 'meshreceipt-preview-status', status: next, ...(message ? { message } : {}),
    }, windowTarget.location.origin);
  }
  function error(reason) { publish('error', reason?.message || String(reason)); }
  return {
    error,
    render(draw, hasModel = true) {
      try { draw(); } catch (reason) { error(reason); throw reason; }
      if (hasModel) publish('ready');
    },
  };
}

// A cached iframe can be hidden while its parent document stays visible.
// Accept pause/resume only from its own parent on the same origin.
export function bindPreviewLifecycle(loop, {
  onResume = () => {}, onDispose = () => {},
  windowTarget = window, documentTarget = document,
} = {}) {
  let embeddedActive = true, away = false, disposed = false;
  const waiters = new Set();
  const isActive = () => !disposed && !away && embeddedActive && !documentTarget.hidden;
  function sync() {
    if (!isActive()) { loop.pause(); return; }
    onResume(); loop.resume();
    for (const resolve of waiters) resolve(true);
    waiters.clear();
  }
  function message(event) {
    if (event.source !== windowTarget.parent || event.origin !== windowTarget.location.origin
      || event.data?.type !== 'meshreceipt-preview-visibility' || typeof event.data.active !== 'boolean') return;
    embeddedActive = event.data.active; sync();
  }
  function pagehide(event) { away = true; loop.pause(); if (!event.persisted) dispose(); }
  function pageshow(event) { if (event.persisted) { away = false; sync(); } }
  function dispose() {
    if (disposed) return;
    disposed = true; loop.dispose();
    documentTarget.removeEventListener('visibilitychange', sync);
    windowTarget.removeEventListener('message', message);
    windowTarget.removeEventListener('pagehide', pagehide);
    windowTarget.removeEventListener('pageshow', pageshow);
    for (const resolve of waiters) resolve(false);
    waiters.clear(); onDispose();
  }
  documentTarget.addEventListener('visibilitychange', sync);
  windowTarget.addEventListener('message', message);
  windowTarget.addEventListener('pagehide', pagehide);
  windowTarget.addEventListener('pageshow', pageshow);
  if (windowTarget.parent !== windowTarget) windowTarget.parent.postMessage({ type: 'meshreceipt-preview-ready' }, windowTarget.location.origin);
  sync();
  return { isActive, dispose, whenActive() {
    if (disposed) return Promise.resolve(false);
    if (isActive()) return Promise.resolve(true);
    return new Promise(resolve => waiters.add(resolve));
  } };
}

export function disposePreviewScene(scene) {
  const geometries = new Set(), materials = new Set(), textures = new Set();
  scene.traverse(object => {
    object.shadow?.dispose?.();
    if (object.geometry) geometries.add(object.geometry);
    for (const material of (Array.isArray(object.material) ? object.material : [object.material])) if (material) {
      materials.add(material);
      for (const value of Object.values(material)) if (value?.isTexture) textures.add(value);
    }
  });
  geometries.forEach(item => item.dispose()); materials.forEach(item => item.dispose()); textures.forEach(item => item.dispose());
}

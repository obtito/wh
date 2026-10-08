import test from 'node:test';
import assert from 'node:assert/strict';
import { createPreviewLoop, createPreviewStatus, bindPreviewLifecycle } from '../js/preview-loop.js';

function fixture() {
  let visible = true, animated = false, nextId = 0;
  const pending = new Map(), rendered = [];
  const loop = createPreviewLoop({
    render: (delta, elapsed) => rendered.push({ delta, elapsed }),
    isAnimating: () => animated, isVisible: () => visible,
    requestFrame: callback => { pending.set(++nextId, callback); return nextId; },
    cancelFrame: id => pending.delete(id),
  });
  return { loop, pending, rendered,
    setVisible(value) { visible = value; }, setAnimated(value) { animated = value; },
    step(time) { const callbacks = [...pending.values()]; pending.clear(); callbacks.forEach(callback => callback(time)); },
  };
}
test('static views stop after drawing and rapid input uses one pending frame', () => {
  const f = fixture();
  for (let i = 0; i < 100; i++) f.loop.invalidate();
  assert.equal(f.pending.size, 1);
  f.step(0);
  assert.equal(f.rendered.length, 1); assert.equal(f.pending.size, 0);
  f.loop.invalidate(); f.step(10_000);
  assert.equal(f.rendered.length, 2); assert.equal(f.rendered[1].delta, 0);
});
test('rotation and night animation keep rendering, then stop when disabled', () => {
  const f = fixture(); f.setAnimated(true); f.loop.invalidate();
  f.step(0); f.step(16); f.step(32);
  assert.equal(f.rendered.length, 3); assert.equal(f.pending.size, 1);
  assert.equal(f.rendered[2].elapsed, 0.032);
  f.setAnimated(false); f.step(48); assert.equal(f.pending.size, 0);
});
test('hidden and cached pages pause; restoring does not cause a camera time jump', () => {
  const f = fixture(); f.setAnimated(true); f.loop.invalidate(); f.step(0); f.step(16);
  f.setVisible(false); f.loop.pause(); f.loop.invalidate(); f.step(5000);
  assert.equal(f.pending.size, 0); assert.equal(f.rendered.length, 2);
  f.setVisible(true); f.loop.resume(); f.step(10_000);
  assert.equal(f.rendered[2].delta, 0); assert.equal(f.rendered[2].elapsed, 0.016);
  f.step(20_000); assert.equal(f.rendered[3].delta, 0.1);
});
test('disposing prevents all subsequent rendering, including a late restore', () => {
  const f = fixture(); f.loop.invalidate(); f.loop.dispose();
  f.loop.resume(); f.loop.invalidate(); f.step(0);
  assert.equal(f.rendered.length, 0); assert.equal(f.pending.size, 0);
});

test('preview content becomes ready only after a successful model draw, once per cached frame', () => {
  const messages = [], windowTarget = { location: { origin: 'http://127.0.0.1:4318' }, parent: { postMessage(...args) { messages.push(args); } } };
  const status = createPreviewStatus({ windowTarget });
  status.render(() => {}, false);
  assert.equal(messages.length, 0, 'empty backgrounds must not reveal the preview');
  status.render(() => { assert.equal(messages.length, 0, 'ready must follow the draw'); });
  assert.deepEqual(messages, [[{ type: 'meshreceipt-preview-status', status: 'ready' }, windowTarget.location.origin]]);
  status.render(() => {}); status.error(new Error('later model switch failed'));
  assert.equal(messages.length, 1, 'cached resumes must not repeat the initial reveal');
});
test('startup and first-draw failures report errors, then a successful retry can become ready', () => {
  const messages = [], windowTarget = { location: { origin: 'http://127.0.0.1:4318' }, parent: { postMessage(message) { messages.push(message); } } };
  const status = createPreviewStatus({ windowTarget });
  status.error(new Error('missing model'));
  status.error(new Error('missing model'));
  assert.equal(messages.length, 1);
  assert.throws(() => status.render(() => { throw new Error('draw failed'); }), /draw failed/);
  assert.deepEqual(messages.map(message => message.status), ['error', 'error']);
  assert.equal(messages[1].message, 'draw failed');
  status.render(() => {});
  assert.deepEqual(messages.map(message => message.status), ['error', 'error', 'ready']);
});

function eventTarget() {
  const listeners = new Map();
  return { addEventListener(type, callback) { listeners.set(type, callback); },
    removeEventListener(type) { listeners.delete(type); },
    emit(type, event = {}) { listeners.get(type)?.(event); } };
}
test('cached iframes pause only for their own parent, resume, and preserve back/forward state', async () => {
  const f = fixture(), win = eventTarget(), doc = eventTarget();
  win.location = { origin: 'http://127.0.0.1:4318' }; win.parent = { postMessage() {} };
  doc.hidden = false; let disposals = 0;
  const lifecycle = bindPreviewLifecycle(f.loop, { windowTarget: win, documentTarget: doc, onDispose() { disposals++; } });
  f.step(0);
  const event = { source: win.parent, origin: win.location.origin, data: { type: 'meshreceipt-preview-visibility', active: false } };
  win.emit('message', { ...event, origin: 'https://other.example' }); assert.equal(lifecycle.isActive(), true);
  win.emit('message', { ...event, source: {} }); assert.equal(lifecycle.isActive(), true);
  win.emit('message', event); assert.equal(lifecycle.isActive(), false);
  f.loop.invalidate(); assert.equal(f.pending.size, 0);
  let resumed = false; const waiting = lifecycle.whenActive().then(value => { resumed = value; });
  win.emit('message', { ...event, data: { ...event.data, active: true } }); await waiting;
  assert.equal(resumed, true); assert.equal(f.pending.size, 1);
  win.emit('pagehide', { persisted: true }); assert.equal(f.pending.size, 0); assert.equal(disposals, 0);
  win.emit('pageshow', { persisted: true }); f.step(5000); assert.equal(f.rendered.at(-1).delta, 0);
  doc.hidden = true; doc.emit('visibilitychange'); assert.equal(f.pending.size, 0);
  const stopped = lifecycle.whenActive(); win.emit('pagehide', { persisted: false });
  assert.equal(await stopped, false); assert.equal(disposals, 1);
  lifecycle.dispose(); assert.equal(disposals, 1);
});

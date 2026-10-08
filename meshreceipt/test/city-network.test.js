import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { loadCityResource } from '../public/city/resource-loader.js';
import { verifySnapshot } from '../public/city/snapshot-check.js';

test('transient timeout retries and returns the recovered bytes', async () => {
  const calls = [], retries = [];
  const bytes = await loadCityResource('/map.json', { fetcher: async (url, options) => {
    calls.push(options.cache);
    if (calls.length === 1) throw new DOMException('signal timed out', 'TimeoutError');
    return new Response(new Uint8Array([1, 2, 3]));
  }, onRetry: info => retries.push(info.attempt) });
  assert.deepEqual([...bytes], [1, 2, 3]);
  assert.deepEqual(calls, ['default', 'reload']); assert.deepEqual(retries, [1]);
});
test('missing files are reported immediately and exhausted retries identify the failing resource', async () => {
  let calls = 0;
  await assert.rejects(loadCityResource('/missing.json', { fetcher: async () => { calls++; return new Response('', { status: 404 }); } }), /404.*missing/);
  assert.equal(calls, 1); calls = 0;
  await assert.rejects(loadCityResource('/slow.json', { fetcher: async () => { calls++; throw new TypeError('Network failure'); } }), /自动重试.*slow/);
  assert.equal(calls, 3);
});
test('closing the page aborts loading without triggering more network attempts', async () => {
  const controller = new AbortController(); let calls = 0;
  await assert.rejects(loadCityResource('/map.json', { signal: controller.signal, fetcher: async () => {
    calls++; controller.abort(); throw controller.signal.reason;
  } }), { name: 'AbortError' });
  assert.equal(calls, 1);
});
test('the complete real city snapshot verifies with at most four concurrent reads', async () => {
  const root = new URL('../public/city/snapshot/', import.meta.url);
  const manifest = JSON.parse(await readFile(new URL('snapshot.json', root)));
  let active = 0, maximum = 0;
  const files = await verifySnapshot(manifest, async name => {
    active++; maximum = Math.max(maximum, active);
    try { return new Uint8Array(await readFile(new URL(name, root))); }
    finally { active--; }
  });
  assert.equal(files.size, 17); assert.ok(maximum <= 4);
});

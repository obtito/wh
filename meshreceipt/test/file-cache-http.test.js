import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';

test('HTTP caching sends 304, notices source edits, and never caches live task/config state', async t => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'meshreceipt-cache-'));
  const dist = path.join(root, 'dist'), vendor = path.join(root, 'GTA-NJ/vendor');
  await Promise.all([mkdir(path.join(dist, 'assets'), { recursive: true }), mkdir(vendor, { recursive: true })]);
  const source = path.join(vendor, 'three.module.js');
  await Promise.all([writeFile(source, 'export const revision = 1;'), writeFile(path.join(dist, 'index.html'), '<h1>Cache test</h1>'),
    writeFile(path.join(dist, 'assets/index-B1_qNGKe.js'), 'console.log(1);')]);
  const app = await createApp({ directory: path.join(root, 'data'), workspace: root, staticDirectory: dist, env: {} });
  t.after(async () => { await new Promise(resolve => app.server.close(resolve)); await rm(root, { recursive: true, force: true }); });
  await new Promise((resolve, reject) => { app.server.once('error', reject); app.server.listen(0, '127.0.0.1', resolve); });
  const base = `http://127.0.0.1:${app.server.address().port}`;
  const url = `${base}/api/source/nanjing/vendor/three.module.js`;
  const first = await fetch(url), tag = first.headers.get('etag');
  assert.equal(first.status, 200); assert.ok(tag); await first.text();
  const cached = await fetch(url, { headers: { 'if-none-match': tag } });
  assert.equal(cached.status, 304); assert.equal(await cached.text(), '');
  await writeFile(source, 'export const revision = 222;');
  const changed = await fetch(url, { headers: { 'if-none-match': tag } });
  assert.equal(changed.status, 200); assert.match(await changed.text(), /222/); assert.notEqual(changed.headers.get('etag'), tag);
  const bundle = await fetch(`${base}/assets/index-B1_qNGKe.js`);
  assert.match(bundle.headers.get('cache-control'), /immutable/); await bundle.text();
  for (const endpoint of ['/api/config', '/api/tasks']) {
    const response = await fetch(`${base}${endpoint}`, { headers: { 'if-none-match': '*' } });
    assert.equal(response.status, 200); assert.equal(response.headers.get('cache-control'), 'no-store'); await response.json();
  }
});

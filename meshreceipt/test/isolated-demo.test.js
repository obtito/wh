import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, symlink } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';

test('isolated static root serves its own build without exposing private storage', async t => {
  const session = await mkdtemp(path.join(os.tmpdir(), 'meshreceipt-isolated-test-'));
  t.after(() => rm(session, { recursive: true, force: true }));
  const staticDirectory = path.join(session, 'frontend');
  await mkdir(staticDirectory);
  await writeFile(path.join(staticDirectory, 'index.html'), '<h1>isolated-build-fixture</h1>');
  const secretFile = path.join(session, 'private.json');
  await writeFile(secretFile, '{"private":"outside-static-boundary"}');
  await symlink(secretFile, path.join(staticDirectory, 'leak.json'));
  const env = { PORT: '0' };
  const app = await createApp({ directory: path.join(session, 'private-store'), staticDirectory, env });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  env.PORT = String(app.server.address().port);
  const base = `http://127.0.0.1:${env.PORT}`;
  assert.equal(await (await fetch(base)).text(), '<h1>isolated-build-fixture</h1>');
  assert.equal((await fetch(`${base}/.env`)).status, 403);
  assert.equal((await fetch(`${base}/leak.json`)).status, 400);
  assert.equal((await fetch(`${base}/api/config`)).status, 200);
  const created = await fetch(`${base}/api/tasks`, { method: 'POST', headers: {
    origin: base, 'content-type': 'application/json', 'x-meshreceipt': 'local-demo',
  }, body: JSON.stringify({ assetId: 'pavilion', mode: 'demo', instruction: 'isolated test' }) });
  assert.equal(created.status, 202);
  await app.jobs.idle();
  const task = await app.store.get((await created.json()).id);
  assert.equal(task.status, 'PASSED');
  assert.equal((await app.store.list()).length, 1);
});

test('core mode is self-contained, serves original fixed evidence and rejects custom mainnet inputs', async t => {
  const session = await mkdtemp(path.join(os.tmpdir(), 'meshreceipt-core-test-'));
  t.after(() => rm(session, { recursive: true, force: true }));
  const env = { PORT: '0', MESHRECEIPT_CORE_ONLY: '1' };
  const app = await createApp({ directory: path.join(session, 'store'), workspace: path.join(session, 'no-neighbor-projects'), env });
  await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => app.server.close(resolve)));
  env.PORT = String(app.server.address().port);
  const base = `http://127.0.0.1:${env.PORT}`;
  assert.equal((await (await fetch(`${base}/api/config`)).json()).coreOnly, true);
  const assets = await (await fetch(`${base}/api/assets`)).json();
  assert.equal(assets.length, 3); assert.ok(assets.every(asset => !asset.previewOnly));
  assert.equal((await fetch(`${base}/api/source/wuhan/assets/model.glb`)).status, 404);
  const evidence = await (await fetch(`${base}/api/mainnet-evidence`)).json();
  assert.equal(evidence.status, 'archive-only'); assert.equal(evidence.scope, 'single-pavilion-pass');
  assert.equal(evidence.localVerification.qualified, true);
  assert.equal(evidence.archive.transactions.length, 3);
  const original = await (await fetch(`${base}/api/mainnet-evidence/bundle`)).json();
  assert.equal(original.manifest.task.id, evidence.archive.delivery.taskId);
  const invalid = await fetch(`${base}/api/mainnet-evidence/verify`, { method: 'POST', headers: {
    origin: base, 'content-type': 'application/json', 'x-meshreceipt': 'local-demo',
  }, body: JSON.stringify({ chainId: 968 }) });
  assert.equal(invalid.status, 400); assert.match((await invalid.json()).error, /不接受其他网络/);
});

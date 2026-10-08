import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { request as httpRequest } from 'node:http';
import { createApp } from '../server/index.js';
import { createStore } from '../server/store.js';
import { createJobs } from '../server/jobs.js';

test('real workflow: failure → retry → pass → historical reuse → disk restart', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'meshreceipt-workflow-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const app = await createApp({ directory, env: {} });
  const first = await app.jobs.create({ assetId: 'pavilion', mode: 'demo', instruction: 'Preserve animation' });
  await app.jobs.idle();
  const stored = await app.store.get(first.id);
  assert.equal(stored.status, 'PASSED');
  assert.equal(stored.attempts.length, 2);
  assert.deepEqual(stored.attempts.map(a => a.verdict), ['FAIL', 'PASS']);
  assert.deepEqual(stored.attempts[0].failedChecks, ['animation']);
  assert.equal(stored.historyUsed.length, 0);
  const proof = await app.jobs.reverify(stored.id, stored.attempts[1].id);
  assert.equal(proof.integrity, true); assert.equal(proof.signatureValid, true); assert.equal(proof.verdict, 'PASS');
  const second = await app.jobs.create({ assetId: 'pavilion', mode: 'demo', instruction: 'Use prior evidence' });
  await app.jobs.idle();
  const reused = await app.store.get(second.id);
  assert.equal(reused.status, 'PASSED'); assert.equal(reused.historyUsed.length, 2);
  assert.equal(reused.attempts.length, 1); assert.equal(reused.attempts[0].providerId, 'careful-demo');
  const reopened = await createStore(directory);
  assert.equal((await reopened.list()).length, 2);
  assert.equal(reopened.verifyDeliverySignature(stored.attempts[1].delivery), true);
  const altered = structuredClone(stored.attempts[1].delivery); altered.payload.outputHash = '0'.repeat(64);
  assert.equal(reopened.verifyDeliverySignature(altered), false);
  const reportPath = path.join(app.store.taskPath(stored.id), stored.attempts[1].id, 'report.json');
  const report = JSON.parse(await readFile(reportPath, 'utf8')); report.verdict = 'FAIL';
  await writeFile(reportPath, JSON.stringify(report));
  assert.equal((await app.jobs.reverify(stored.id, stored.attempts[1].id)).integrity, false);
  await assert.rejects(app.jobs.create({ assetId: 'zifeng', mode: 'demo', instruction: '' }), /preview-only/);
  await assert.rejects(app.jobs.create({ assetId: 'mingxiaoling', mode: 'demo', instruction: '' }), /preview-only/);
  await assert.rejects(app.jobs.create({ assetId: 'zhongshanling', mode: 'demo', instruction: '' }), /preview-only/);
  await assert.rejects(app.jobs.create({ assetId: 'wuhan-landmarks', mode: 'demo', instruction: '' }), /preview-only/);
  await assert.rejects(app.jobs.create({ assetId: 'huanghe', mode: 'demo', instruction: '' }), /preview-only/);
  await assert.rejects(app.jobs.create({ assetId: 'pavilion', mode: 'model', instruction: '' }), /not configured/);
  await assert.rejects(app.jobs.create({ assetId: 'pavilion', mode: 'demo', instruction: '', policy: {} }), /Unknown task fields/);
  assert.throws(() => app.store.taskPath('../escape'));
});

test('restart marks unfinished tasks interrupted, not passed', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'meshreceipt-restart-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const store = await createStore(directory);
  const task = { id: '12345678-1234-4234-8234-123456789abc', createdAt: new Date().toISOString(), status: 'RUNNING', attempts: [{ status: 'RUNNING' }] };
  await store.save(task); await createJobs(store, [], { env: {} });
  const reopened = await store.get(task.id);
  assert.equal(reopened.status, 'INTERRUPTED'); assert.equal(reopened.attempts[0].status, 'ERROR');
});

test('simultaneous task creation cannot bypass the queue cap', async () => {
  let release;
  const blocked = new Promise(resolve => { release = resolve; });
  const store = { list: async () => [] };
  const jobs = await createJobs(store, [{ id: 'sample', file: '/unused' }], { env: {} });
  store.list = async () => { await blocked; throw new Error('fixture stopped'); };
  const body = { assetId: 'sample', mode: 'demo', instruction: '' };
  const results = Array.from({ length: 4 }, () => jobs.create(body).catch(error => error.message));
  await assert.rejects(jobs.create(body), /queue is full/);
  release();
  assert.deepEqual(await Promise.all(results), Array(4).fill('fixture stopped'));
  await assert.rejects(jobs.create(body), /fixture stopped/);
});

test('HTTP rejects cross-origin writes, missing headers, traversal and unknown assets', async t => {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'meshreceipt-http-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  const { server } = await createApp({ directory, env: {} });
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => new Promise(resolve => server.close(resolve)));
  const base = `http://127.0.0.1:${server.address().port}`;
  const config = await (await fetch(`${base}/api/config`)).json();
  assert.equal(config.modelAvailable, false); assert.equal(config.modelStatus, 'not-configured'); assert.equal(config.modelName, null);
  assert.equal((await fetch(`${base}/api/assets`)).status, 200);
  const hostileHostStatus = await new Promise((resolve, reject) => {
    const request = httpRequest(`${base}/api/assets`, { headers: { host: 'evil.example' } }, response => {
      response.resume(); resolve(response.statusCode);
    });
    request.on('error', reject); request.end();
  });
  assert.equal(hostileHostStatus, 403);
  const noHeaders = await fetch(`${base}/api/tasks`, { method: 'POST', body: '{}' });
  assert.equal(noHeaders.status, 400);
  const cross = await fetch(`${base}/api/tasks`, { method: 'POST', headers: { origin: 'https://evil.example', 'content-type': 'application/json', 'x-meshreceipt': 'local-demo' }, body: '{}' });
  assert.equal(cross.status, 403);
  assert.equal((await fetch(`${base}/api/source/nanjing/.git/config`)).status, 403);
  assert.equal((await fetch(`${base}/api/source/nanjing/js/%2e%2e%2f%2e%2e%2f.env`)).status, 403);
  assert.equal((await fetch(`${base}/api/tasks/not-a-uuid`)).status, 400);
});

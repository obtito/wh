import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { createApp } from '../server/index.js';
import { verifyBundle } from '../src/bundle.js';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';

const env = { OPENAI_API_KEY: 'fixture-key-not-live', OPENAI_MODEL: 'fixture-model' };
const response = (id, name, args = {}) => ({ ok: true, json: async () => ({ id: `resp_${id}`, status: 'completed', output: [
  { type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) },
] }) });
async function application(t, fetcher) {
  const directory = await mkdtemp(path.join(os.tmpdir(), 'meshreceipt-model-flow-'));
  t.after(() => rm(directory, { recursive: true, force: true }));
  return createApp({ directory, env, fetcher });
}

test('model path: fixture API chooses neutral services, actual workers reject then pass and release verifies', async t => {
  const requests = [];
  const replies = [response('q', 'query_records'), response('a', 'run_service', { providerId: 'service-a' }), response('b', 'run_service', { providerId: 'service-b' })];
  const app = await application(t, async (url, options) => { requests.push(JSON.parse(options.body)); return replies.shift(); });
  const task = await app.jobs.create({ assetId: 'pavilion', mode: 'model', instruction: 'Preserve geometry and animation', confirmModelData: true });
  await app.jobs.idle();
  const stored = await app.store.get(task.id);
  assert.equal(stored.status, 'PASSED'); assert.deepEqual(stored.attempts.map(a => a.verdict), ['FAIL', 'PASS']);
  assert.deepEqual(stored.attempts.map(a => a.providerName), ['服务 A', '服务 B']);
  assert.equal(stored.agentRun.source, 'test-fixture'); assert.equal(stored.agentRun.status, 'PASSED');
  assert.equal(stored.modelConsent.confirmed, true); assert.equal(requests.length, 3);
  const transmitted = JSON.stringify(requests);
  for (const hint of ['rapid-demo', 'careful-demo', '故障注入', 'drop-animation', '删除动画']) assert.ok(!transmitted.includes(hint));
  const last = stored.attempts.at(-1);
  const proof = await app.jobs.reverify(task.id, last.id); assert.equal(proof.integrity, true); assert.equal(proof.signatureValid, true);
  const bundle = JSON.parse((await app.exportBundle(task.id, last.id, { kind: 'qualified', confirmDistribution: true })).serialized);
  const verified = await verifyBundle(bundle, { issuer: last.delivery.issuer, instance: last.delivery.instance, providerId: last.providerId });
  assert.equal(verified.result.qualified, true);
  assert.ok(!JSON.stringify(bundle).includes(env.OPENAI_API_KEY)); assert.ok(!JSON.stringify(bundle).includes('resp_q'));
});

test('model disclosure confirmation is required before creating files or invoking the API', async t => {
  let requests = 0;
  const app = await application(t, async () => { requests++; throw new Error('should not call'); });
  for (const consent of [undefined, false, 'true']) await assert.rejects(app.jobs.create({ assetId: 'pavilion', mode: 'model', instruction: '', confirmModelData: consent }), /confirmation/);
  assert.equal((await app.store.list()).length, 0); assert.equal(requests, 0);
});

test('API failure after a rejected delivery does not silently retry via deterministic demo', async t => {
  const replies = [response('q', 'query_records'), response('a', 'run_service', { providerId: 'service-a' }), { ok: false, status: 401 }];
  const app = await application(t, async () => replies.shift());
  const task = await app.jobs.create({ assetId: 'pavilion', mode: 'model', instruction: '', confirmModelData: true });
  await app.jobs.idle();
  const stored = await app.store.get(task.id);
  assert.equal(stored.mode, 'model'); assert.equal(stored.status, 'ERROR'); assert.equal(stored.agentRun.status, 'ERROR');
  assert.equal(stored.attempts.length, 1); assert.equal(stored.attempts[0].verdict, 'FAIL'); assert.match(stored.error, /401/);
});

test('live smoke command fails closed without credentials, before creating sample or task storage', async () => {
  const script = fileURLToPath(new URL('../scripts/agent-smoke.js', import.meta.url));
  await assert.rejects(promisify(execFile)(process.execPath, [script], { cwd: os.tmpdir(), env: { ...process.env, OPENAI_API_KEY: '', OPENAI_MODEL: '' } }), error => {
    assert.equal(error.code, 3); assert.equal(error.stdout, '');
    assert.match(JSON.parse(error.stderr).error, /Configure OPENAI_API_KEY/); return true;
  });
});

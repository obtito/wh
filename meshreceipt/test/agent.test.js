import test from 'node:test';
import assert from 'node:assert/strict';
import { runModelAgent, liveConfigured, modelSettings } from '../server/agent.js';

const env = { OPENAI_API_KEY: 'test-only-secret', OPENAI_MODEL: 'test-model' };
const providers = [
  { id: 'rapid-demo', agentId: 'service-a', name: '故障注入', description: '删除动画', costUnits: 1, fault: 'drop-animation', privateKey: 'not-for-model' },
  { id: 'careful-demo', agentId: 'service-b', name: '保守优化', description: '好服务', costUnits: 2 },
];
const call = (id, name, args = {}) => ({ type: 'function_call', call_id: id, name, arguments: JSON.stringify(args) });
const reply = (...output) => ({ id: 'resp_fixture', status: 'completed', output, usage: { input_tokens: 11, output_tokens: 12, total_tokens: 23 } });
async function scenario(responses, { verdict = 'PASS', records = [], fetchError } = {}) {
  const requests = [], logs = [], executed = [];
  const task = { assetTitle: 'Fixture', policy: { version: 'fixed' }, instruction: 'Private task text', attempts: [] };
  const params = { task, env,
    fetcher: async (url, options) => {
      requests.push({ url, ...options, body: JSON.parse(options.body) });
      if (fetchError) throw fetchError;
      return { ok: true, json: async () => responses.shift() };
    },
    query: async () => ({ providers, records }),
    run: async providerId => {
      executed.push(providerId); task.attempts.push({ id: `attempt-${executed.length}`, providerId, status: 'COMPLETED', verdict, failedChecks: verdict === 'FAIL' ? ['animation'] : [] });
    }, log: async (kind, message) => logs.push({ kind, message }) };
  return { task, requests, executed, logs, params, run: () => runModelAgent(params) };
}

test('Responses adapter executes tools and passes prior output with correlated call_id', async () => {
  const requests = [], logs = [], task = { assetTitle: 'Fixture', policy: { maxOutputBytes: 400000 }, instruction: 'Preserve', attempts: [] };
  const responses = [
    { output: [{ type: 'function_call', call_id: 'call-1', name: 'query_records', arguments: '{}' }] },
    { output: [{ type: 'function_call', call_id: 'call-2', name: 'run_service', arguments: '{"providerId":"service-b"}' }] },
  ];
  await runModelAgent({ task, env: { OPENAI_API_KEY: 'test-only', OPENAI_MODEL: 'test-model' },
    fetcher: async (url, options) => { requests.push(JSON.parse(options.body)); return { ok: true, json: async () => responses.shift() }; },
    query: async () => ({ providers, records: [] }), run: async providerId => { task.attempts.push({ providerId, status: 'COMPLETED', verdict: 'PASS' }); return { verdict: 'PASS' }; },
    log: async (kind, message) => logs.push({ kind, message }),
  });
  assert.equal(requests.length, 2);
  assert.ok(requests[1].input.some(item => item.type === 'function_call_output' && item.call_id === 'call-1'));
  assert.equal(requests[0].store, false); assert.equal(requests[0].parallel_tool_calls, false);
  assert.equal(task.attempts[0].providerId, 'careful-demo');
});

test('unconfigured/erroring live model never silently becomes demo', async () => {
  const params = { task: { attempts: [] }, query: async () => {}, run: async () => { throw new Error('should not execute'); }, log: async () => {} };
  await assert.rejects(runModelAgent({ ...params, env: {} }), /not configured/);
  await assert.rejects(runModelAgent({ ...params, env: { OPENAI_API_KEY: 'test', OPENAI_MODEL: 'test' },
    fetcher: async () => ({ ok: false, status: 401 }) }), /401/);
});

test('model catalog uses neutral aliases and never forwards legacy names, faults or secrets', async () => {
  const flow = await scenario([reply(call('q', 'query_records')), reply(call('b', 'run_service', { providerId: 'service-b' }))]);
  await flow.run();
  const catalog = flow.requests[1].body.input.find(item => item.type === 'function_call_output');
  const data = JSON.parse(catalog.output);
  assert.deepEqual(data.providers.map(provider => provider.providerId), ['service-a', 'service-b']);
  for (const secret of ['rapid-demo', 'careful-demo', '故障注入', '删除动画', '保守优化', 'drop-animation', 'not-for-model']) assert.ok(!JSON.stringify(flow.requests.map(r => r.body)).includes(secret));
  assert.equal(data.assurance, 'local-cache-not-independently-reverified');
  assert.deepEqual(flow.executed, ['careful-demo']);
  assert.deepEqual(flow.requests[0].body.tool_choice, { type: 'function', name: 'query_records' });
  assert.equal(flow.requests[0].redirect, 'error');
});

test('reasoning items are replayed untouched in memory, never persisted into invocation evidence', async () => {
  const reasoning = { type: 'reasoning', id: 'rs_fixture', encrypted_content: 'private-encrypted-state', summary: [{ text: 'private-reasoning' }] };
  const flow = await scenario([reply(reasoning, call('q', 'query_records')), reply(call('b', 'run_service', { providerId: 'service-b' }))]);
  await flow.run();
  assert.deepEqual(flow.requests[1].body.input.find(item => item.type === 'reasoning'), reasoning);
  assert.equal(flow.task.agentRun.source, 'test-fixture'); assert.equal(flow.task.agentRun.status, 'PASSED');
  assert.equal(flow.task.agentRun.rounds[0].responseId, 'resp_fixture'); assert.equal(flow.task.agentRun.rounds[0].usage.total_tokens, 23);
  for (const text of ['private-reasoning', 'private-encrypted-state', env.OPENAI_API_KEY, flow.task.instruction]) assert.ok(!JSON.stringify(flow.task.agentRun).includes(text));
});

test('run before history lookup is rejected even if the model disregards forced tool choice', async () => {
  const flow = await scenario([reply(call('early', 'run_service', { providerId: 'service-a' })), reply(call('q', 'query_records')), reply(call('b', 'run_service', { providerId: 'service-b' }))]);
  await flow.run();
  assert.deepEqual(flow.executed, ['careful-demo']); assert.equal(flow.task.agentRun.rounds[0].calls[0].status, 'REJECTED');
});

test('unknown tool, legacy provider ID and rule-changing arguments cannot execute', async () => {
  const flow = await scenario([reply(call('q', 'query_records')), reply(call('unknown', 'send_money', { amount: 100 })),
    reply(call('legacy', 'run_service', { providerId: 'careful-demo' })), reply(call('rules', 'run_service', { providerId: 'service-a', policy: {} })),
    reply(call('report', 'get_task_report')), reply(call('b', 'run_service', { providerId: 'service-b' }))]);
  await flow.run(); assert.deepEqual(flow.executed, ['careful-demo']); assert.deepEqual(flow.task.policy, { version: 'fixed' });
  assert.equal(flow.task.agentRun.rounds.filter(r => r.calls[0].status === 'REJECTED').length, 3);
});

test('duplicate service is rejected and two different failures stop without a third API call', async () => {
  const flow = await scenario([reply(call('q', 'query_records')), reply(call('a', 'run_service', { providerId: 'service-a' })),
    reply(call('a2', 'run_service', { providerId: 'service-a' })), reply(call('b', 'run_service', { providerId: 'service-b' }))], { verdict: 'FAIL' });
  await flow.run(); assert.deepEqual(flow.executed, ['rapid-demo', 'careful-demo']); assert.equal(flow.requests.length, 4);
  assert.equal(flow.task.agentRun.status, 'EXHAUSTED'); assert.equal(flow.task.agentRun.rounds[2].calls[0].status, 'REJECTED');
});

test('PASS hard stop prevents further model requests or services', async () => {
  const flow = await scenario([reply(call('q', 'query_records')), reply(call('b', 'run_service', { providerId: 'service-b' })),
    reply(call('a', 'run_service', { providerId: 'service-a' }))]);
  await flow.run(); assert.equal(flow.requests.length, 2); assert.deepEqual(flow.executed, ['careful-demo']);
});

test('a tool return claiming PASS without a completed code attempt does not stop as accepted', async () => {
  const flow = await scenario([reply(call('q', 'query_records')), reply(call('a', 'run_service', { providerId: 'service-a' })), reply(call('b', 'run_service', { providerId: 'service-b' }))]);
  flow.params.run = async () => ({ verdict: 'PASS' });
  await flow.run(); assert.equal(flow.task.agentRun.status, 'EXHAUSTED'); assert.equal(flow.task.attempts.length, 0);
});

test('parallel response batch is rejected atomically before any tool executes', async () => {
  const flow = await scenario([reply(call('q', 'query_records'), call('a', 'run_service', { providerId: 'service-a' }))]);
  await assert.rejects(flow.run(), /Parallel/); assert.equal(flow.executed.length, 0); assert.equal(flow.task.agentRun.status, 'ERROR');
});

test('replayed or missing call_id is rejected before a service side effect', async () => {
  const flow = await scenario([reply(call('same', 'query_records')), reply(call('same', 'run_service', { providerId: 'service-a' }))]);
  await assert.rejects(flow.run(), /replayed/); assert.equal(flow.executed.length, 0);
  const missing = await scenario([reply({ type: 'function_call', name: 'query_records', arguments: '{}' })]);
  await assert.rejects(missing.run(), /Invalid/);
});

test('incomplete response and natural-language PASS cannot become code acceptance', async () => {
  const truncated = await scenario([{ ...reply(call('q', 'query_records')), status: 'incomplete' }]);
  await assert.rejects(truncated.run(), /did not complete/); assert.equal(truncated.executed.length, 0);
  const invented = await scenario([reply({ type: 'message', content: [{ type: 'output_text', text: 'PASS, everything worked' }] })]);
  await assert.rejects(invented.run(), /without running/); assert.equal(invented.task.attempts.length, 0);
});

test('malformed tool JSON is rejected and the model can recover within the fixed round budget', async () => {
  const flow = await scenario([reply({ ...call('bad', 'query_records'), arguments: '{bad' }), reply(call('q', 'query_records')), reply(call('b', 'run_service', { providerId: 'service-b' }))]);
  await flow.run(); assert.equal(flow.task.agentRun.rounds[0].calls[0].status, 'REJECTED'); assert.equal(flow.executed.length, 1);
  const loop = await scenario(Array.from({ length: 6 }, (_, i) => reply(call(`q${i}`, 'query_records'))));
  await assert.rejects(loop.run(), /round limit/); assert.equal(loop.requests.length, 6);
});

test('invalid endpoint configuration never sends API credentials', async () => {
  for (const base of ['http://evil.example/v1', 'ftp://localhost/v1', 'https://user:pass@example.com/v1', 'https://example.com/v1?key=secret', 'https://example.com/v1#fragment']) {
    const flow = await scenario([]); flow.params.env = { ...env, OPENAI_BASE_URL: base };
    await assert.rejects(flow.run(), /endpoint/); assert.equal(flow.requests.length, 0);
  }
  assert.equal(liveConfigured({ OPENAI_API_KEY: ' ', OPENAI_MODEL: 'test' }), false);
});

test('network exceptions are sanitized rather than logging credentials or raw errors', async () => {
  const flow = await scenario([], { fetchError: new Error(`Private request ${env.OPENAI_API_KEY}`) });
  await assert.rejects(flow.run(), /request failed/); assert.equal(flow.task.agentRun.status, 'ERROR');
  assert.ok(!JSON.stringify(flow.task.agentRun).includes(env.OPENAI_API_KEY));
  const timeout = await scenario([], { fetchError: Object.assign(new Error('hidden'), { name: 'TimeoutError' }) });
  await assert.rejects(timeout.run(), /timed out/);
});

test('key-only configuration explicitly requests Astra medium with unchanged API limits', async () => {
  const flow = await scenario([reply(call('q', 'query_records')), reply(call('b', 'run_service', { providerId: 'service-b' }))]);
  flow.params.env = { OPENAI_API_KEY: env.OPENAI_API_KEY };
  assert.equal(liveConfigured(flow.params.env), true);
  await flow.run();
  for (const request of flow.requests) {
    assert.equal(request.body.model, 'gpt-6-astra'); assert.deepEqual(request.body.reasoning, { effort: 'medium' });
    assert.equal(request.body.max_output_tokens, 1800); assert.equal(request.body.store, false);
    for (const parameter of ['service_tier', 'temperature', 'top_p', 'top_logprobs']) assert.ok(!(parameter in request.body));
  }
  assert.equal(flow.task.agentRun.model, 'gpt-6-astra'); assert.equal(flow.task.agentRun.reasoningEffort, 'medium');
});

test('explicit max effort is retained throughout a task without changing a selected model', async () => {
  const flow = await scenario([reply(call('q', 'query_records')), reply(call('b', 'run_service', { providerId: 'service-b' }))]);
  flow.params.env = { ...env, OPENAI_MODEL: ' test-model ', OPENAI_REASONING_EFFORT: ' max ' };
  await flow.run();
  assert.ok(flow.requests.every(request => request.body.model === 'test-model' && request.body.reasoning.effort === 'max'));
  assert.equal(flow.task.agentRun.reasoningEffort, 'max');
});

test('unsupported effort fails locally before any model request without exposing its value', async () => {
  for (const effort of ['ultra', '1.5', 'none', 'minimal', 'medium\ninvalid-private-value']) {
    const flow = await scenario([]); flow.params.env = { ...env, OPENAI_REASONING_EFFORT: effort };
    assert.equal(liveConfigured(flow.params.env), false);
    await assert.rejects(flow.run(), error => error.message.startsWith('OPENAI_REASONING_EFFORT must be') && !error.message.includes(effort));
    assert.equal(flow.requests.length, 0); assert.equal(flow.executed.length, 0);
  }
  assert.deepEqual(modelSettings({ OPENAI_REASONING_EFFORT: ' ' }), { model: 'gpt-6-astra', reasoningEffort: 'medium' });
});

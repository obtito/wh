import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { transform } from 'esbuild';

// Compile the local JSX in memory with Vite's existing compiler; no server or build cache required.
async function render(name, props) {
  const source = await readFile(new URL(`../web/${name}.jsx`, import.meta.url), 'utf8');
  const compiled = await transform(source, { loader: 'jsx', format: 'cjs' });
  const module = { exports: {} };
  new Function('require', 'module', 'exports', compiled.code)(createRequire(import.meta.url), module, module.exports);
  return renderToStaticMarkup(React.createElement(module.exports.default, props));
}
const controls = { mode: 'model', confirmed: false, config: { modelAvailable: true, modelName: 'fixture-model', modelReasoningEffort: 'medium' }, busy: false, running: false,
  onModeChange() {}, onConfirmedChange() {}, onStart() {} };
const button = html => html.match(/<button[^>]*>/)[0];

test('model UI requires explicit disclosure consent and locks controls while running', async () => {
  const unconfirmed = await render('ModelControls', controls);
  assert.match(button(unconfirmed), /disabled/); assert.match(unconfirmed, /允许本次付费调用/); assert.match(unconfirmed, /不发送 GLB 或私钥/);
  assert.match(unconfirmed, /推理档位：medium/);
  assert.doesNotMatch(button(await render('ModelControls', { ...controls, confirmed: true })), /disabled/);
  assert.match(button(await render('ModelControls', { ...controls, confirmed: true, running: true })), /disabled/);
});

test('missing configuration disables live mode but keeps deterministic demo available', async () => {
  const html = await render('ModelControls', { ...controls, mode: 'demo', config: { modelAvailable: false } });
  assert.match(html, /<option value="model" disabled="">/); assert.match(html, /实时模型未配置/); assert.doesNotMatch(button(html), /disabled/);
});

test('invocation UI labels fixtures explicitly and never treats old tasks as complete API evidence', async () => {
  const html = await render('ModelEvidence', { trace: { source: 'test-fixture', model: '<script>fixture</script>', reasoningEffort: 'max', status: 'PASSED', rounds: [
    { round: 1, responseReceived: true, status: 'completed', responseId: 'resp_fixture', calls: [{ callId: 'q', tool: 'query_records', status: 'EXECUTED' }] },
  ] } });
  assert.match(html, /测试夹具响应，不是真实联网 AI/); assert.match(html, /1 轮响应/); assert.match(html, /未提供/);
  assert.match(html, /请求推理档位：max/);
  assert.ok(!html.includes('<script>')); assert.match(await render('ModelEvidence', {}), /不能据此展示完整 API 调用证据/);
});

test('qualified export prominently states unverified visual quality, without promising overall acceptance', async () => {
  const task = { id: 'task', distributionSource: { license: 'CC0-1.0' } };
  const attempt = { id: 'attempt', verdict: 'PASS', providerId: 'careful-demo', delivery: { issuer: 'issuer', instance: 'instance' } };
  const html = await render('BundleExport', { task, attempt });
  assert.match(html, /材质、纹理视觉质量未验收/);
  assert.match(html, /不代表整体质量合格/);
  assert.match(html, /导出限定规则合格包/);
  assert.doesNotMatch(await render('BundleExport', { task, attempt: { ...attempt, verdict: 'FAIL' } }), /导出限定规则合格包/);
  const source = await readFile(new URL('../web/main.jsx', import.meta.url), 'utf8');
  assert.match(source, /attempt\.verdict === 'PASS' && <p className="quality-boundary">限定规则通过；材质、纹理视觉质量未验收/);
  assert.match(source, /setChainFresh\(false\)/);
  assert.match(source, /onClick=\{recheckChain\}/);
});

test('chain evidence renders cache versus fresh confirmation, and never endorses mismatched context', async () => {
  const evidence = { network: 968, contract: `0x${'1'.repeat(40)}`, transactions: [`0x${'2'.repeat(64)}`], checkedAt: '2026-10-07T00:00:00.000Z' };
  const cached = await render('ChainEvidence', { evidence, contextMatches: true });
  assert.match(cached, /历史缓存（未重新核验）/); assert.doesNotMatch(cached, /本次重新核验：/);
  assert.match(cached, /缓存不是可信证据/); assert.match(cached, /https:\/\/scan\.bohr\.life\/tx\//);
  const fresh = await render('ChainEvidence', { evidence, fresh: true, contextMatches: true });
  assert.match(fresh, /本次重新核验：/); assert.match(fresh, /已读取该链上的任务及全部已完成回执/);
  const mismatched = await render('ChainEvidence', { evidence, fresh: true, contextMatches: false });
  assert.match(mismatched, /历史缓存（未重新核验）/); assert.doesNotMatch(mismatched, /本次重新核验：/);
  assert.match(mismatched, /请重新核对/);
});

test('published receipt separates the single archived PASS, fresh read and historical AI invocation', async () => {
  const archive = JSON.parse(await readFile(new URL('../docs/evidence/mainnet-original.json', import.meta.url), 'utf8'));
  const invocation = JSON.parse(await readFile(new URL('../docs/evidence/agent-invocation.json', import.meta.url), 'utf8'));
  const evidence = { archive, status: 'archive-only', invocation: { ...invocation, note: '历史调用，不重新调用模型' } };
  const cached = await render('MainnetReceipt', { evidence });
  assert.match(cached, /主网历史凭据已归档/); assert.doesNotMatch(cached, /本次主网只读核对通过/);
  assert.match(cached, /FAIL 保留链下取证/); assert.match(cached, /这一份 PASS/);
  assert.match(cached, /非本次实时调用/); assert.match(cached, /1653 tokens/); assert.match(cached, /service-a → FAIL/);
  assert.equal((cached.match(/https:\/\/scan\.botchain\.ai\/tx\//g) || []).length, 3);
  const wrongScope = await render('MainnetReceipt', { evidence: { ...evidence, status: 'verified-now', chainVerification: { scope: 'all-attempts' } } });
  assert.doesNotMatch(wrongScope, /本次主网只读核对通过/);
  const fresh = await render('MainnetReceipt', { evidence: { ...evidence, status: 'verified-now', chainVerification: { scope: 'single-pavilion-pass', checkedAt: 'fresh-fixture' } } });
  assert.match(fresh, /本次主网只读核对通过/); assert.match(fresh, /fresh-fixture/);
  const failed = await render('MainnetReceipt', { evidence, error: 'RPC 超时', busy: true });
  assert.match(failed, /RPC 超时/); assert.match(failed, /不显示本次验证成功/); assert.match(button(failed), /disabled/);
});

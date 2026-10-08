import test from 'node:test';
import assert from 'node:assert/strict';
import { id, ZeroAddress } from 'ethers';
import { chainContextMatches, createChainEvidence, parseChainEvidence, verifyChainRecords } from '../web/chain-evidence.js';

const config = { chainId: 968, contractAddress: `0x${'1'.repeat(40)}` };
const task = { id: 'task', inputHash: '2'.repeat(64), policyHash: '3'.repeat(64), attempts: [
  { id: 'attempt', status: 'COMPLETED', verdict: 'PASS', outputHash: '4'.repeat(64), reportHash: '5'.repeat(64), delivery: { issuer: `0x${'6'.repeat(40)}` } },
] };
function reader({ storedTask = {}, receipt = {} } = {}) {
  const calls = [];
  return { calls,
    async tasks(taskId) { calls.push(['task', taskId]); return { requester: `0x${'7'.repeat(40)}`, inputHash: `0x${task.inputHash}`, policyHash: `0x${task.policyHash}`, ...storedTask }; },
    async receipts(attemptId) { calls.push(['receipt', attemptId]); const attempt = task.attempts[0];
      return { taskId: id(task.id), provider: attempt.delivery.issuer, outputHash: `0x${attempt.outputHash}`, reportHash: `0x${attempt.reportHash}`, verdict: 1n, ...receipt }; },
  };
}

test('legacy and current cache parse as display data; persisted fresh flags are discarded', () => {
  const evidence = createChainEvidence(task, config, [`0x${'8'.repeat(64)}`]);
  assert.ok(chainContextMatches(evidence, task, config));
  const parsed = parseChainEvidence({ ...evidence, fresh: true, signatureValid: true });
  assert.equal(parsed.fresh, undefined); assert.equal(parsed.signatureValid, undefined);
  const legacy = { ...evidence }; delete legacy.scope;
  assert.ok(parseChainEvidence(legacy)); assert.equal(chainContextMatches(parseChainEvidence(legacy), task, config), false);
});

test('malformed cache cannot crash rendering or provide arbitrary transaction links', () => {
  const evidence = createChainEvidence(task, config);
  for (const value of [null, {}, { ...evidence, transactions: 'not-an-array' }, { ...evidence, network: '968' },
    { ...evidence, transactions: ['javascript:alert(1)'] }, { ...evidence, contract: 'javascript:alert(1)' }, { ...evidence, checkedAt: 'invalid' }]) {
    assert.equal(parseChainEvidence(value), null);
  }
});

test('evidence context must match network, contract, input, rules and all current delivery fingerprints', () => {
  const evidence = createChainEvidence(task, config);
  assert.equal(chainContextMatches(evidence, task, { ...config, chainId: 677 }), false);
  assert.equal(chainContextMatches(evidence, task, { ...config, contractAddress: `0x${'9'.repeat(40)}` }), false);
  for (const key of ['inputHash', 'policyHash']) assert.equal(chainContextMatches(evidence, { ...task, [key]: '0'.repeat(64) }, config), false);
  for (const key of ['outputHash', 'reportHash', 'verdict']) {
    const changed = structuredClone(task); changed.attempts[0][key] = key === 'verdict' ? 'FAIL' : '0'.repeat(64);
    assert.equal(chainContextMatches(evidence, changed, config), false);
  }
  const expanded = structuredClone(task); expanded.attempts.push({ ...expanded.attempts[0], id: 'attempt-2' });
  assert.equal(chainContextMatches(evidence, expanded, config), false);
});

test('read-only verification checks the actual task and receipts without any transaction methods', async () => {
  const contract = reader();
  assert.deepEqual(await verifyChainRecords(contract, task), { checkedReceipts: 1 });
  assert.deepEqual(contract.calls, [['task', id(task.id)], ['receipt', id(`${task.id}:attempt`)]]);
});

test('read-only verification refuses absent tasks, changed commitments and incomplete receipts', async () => {
  await assert.rejects(verifyChainRecords(reader({ storedTask: { requester: ZeroAddress } }), task), /尚未登记/);
  await assert.rejects(verifyChainRecords(reader({ storedTask: { inputHash: id('wrong-input') } }), task), /任务不一致/);
  await assert.rejects(verifyChainRecords(reader({ receipt: { verdict: 0n } }), task), /尚未记录/);
  await assert.rejects(verifyChainRecords(reader(), { ...task, attempts: [] }), /没有已完成/);
});

test('read-only verification refuses mismatched output, report, service, task and verdict', async () => {
  for (const receipt of [{ outputHash: id('wrong-output') }, { reportHash: id('wrong-report') },
    { provider: `0x${'9'.repeat(40)}` }, { taskId: id('wrong-task') }, { verdict: 2n }]) {
    await assert.rejects(verifyChainRecords(reader({ receipt }), task), /尝试不一致/);
  }
});

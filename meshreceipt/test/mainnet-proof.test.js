import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { compileRegistry } from '../scripts/compile-contract.js';
import { validateMainnetArchive, verifyMainnetOnProvider, TRANSACTIONS } from '../src/mainnet-proof.js';
import { ACCOUNT, FIXED, commitmentKeys, requestFor, runtimeFor } from '../experiments/bot-mainnet/protocol.js';

const archive = JSON.parse(await readFile(new URL('../docs/evidence/mainnet-original.json', import.meta.url), 'utf8'));
const artifact = await compileRegistry();
async function fixture() {
  const calls = [], transactions = await Promise.all(TRANSACTIONS.map(async (hash, i) => ({
    hash, chainId: 677n, from: ACCOUNT, to: i ? archive.contract : null, nonce: i, value: 0n,
    data: (await requestFor(i, artifact, archive.contract)).data, gasLimit: BigInt(archive.transactions[i].gasLimit), gasPrice: 24_000_000_000n,
  })));
  const receipts = archive.transactions.map(tx => ({ hash: tx.hash, status: 1, blockNumber: tx.blockNumber,
    contractAddress: tx.step ? null : archive.contract, gasUsed: BigInt(tx.gasUsed), gasPrice: 24_000_000_000n, fee: BigInt(tx.feeWei) }));
  const keys = commitmentKeys();
  return { calls, transactions, receipts,
    provider: { async getNetwork() { calls.push('network'); return { chainId: 677n }; },
      async getCode() { calls.push('code'); return runtimeFor(artifact); },
      async getTransaction(hash) { calls.push(`tx:${hash}`); return transactions[TRANSACTIONS.indexOf(hash)]; },
      async getTransactionReceipt(hash) { calls.push(`receipt:${hash}`); return receipts[TRANSACTIONS.indexOf(hash)]; } },
    contract: { async attester() { return ACCOUNT; }, async tasks(id) { assert.equal(id, keys.task); return { requester: ACCOUNT, inputHash: `0x${FIXED.inputHash}`, policyHash: `0x${FIXED.policyHash}` }; },
      async receipts(id) { assert.equal(id, keys.attempt); return { taskId: keys.task, provider: FIXED.provider, outputHash: `0x${FIXED.outputHash}`, reportHash: `0x${FIXED.reportHash}`, verdict: 1n }; } },
  };
}
test('published proof reads exactly the archived single PASS and the three original transactions', async () => {
  const f = await fixture(), result = await verifyMainnetOnProvider(archive, artifact, f.provider, f.contract);
  assert.equal(result.scope, 'single-pavilion-pass'); assert.equal(result.status, 'verified-now');
  assert.equal(result.spentBOT, '0.01617948'); assert.equal(result.transactions.length, 3);
  assert.equal(f.calls.filter(x => x.startsWith('tx:')).length, 3);
  assert.match(result.confirmation, /finality not independently checked/);
});
test('archive rejects a different network, attempt, output, transaction, or expanded scope', () => {
  for (const change of [a => { a.chainId = 968; }, a => { a.delivery.attemptId = 'other'; }, a => { a.delivery.outputHash = '0'.repeat(64); },
    a => { a.transactions[2].hash = `0x${'1'.repeat(64)}`; }, a => { a.transactions.push(a.transactions[2]); }]) {
    const changed = structuredClone(archive); change(changed); assert.throws(() => validateMainnetArchive(changed));
  }
});
test('fresh proof rejects wrong chain, runtime, pending, altered calldata and bad PASS', async () => {
  for (const mutate of [f => { f.provider.getNetwork = async () => ({ chainId: 968n }); },
    f => { f.provider.getCode = async () => '0x00'; }, f => { f.receipts[2] = null; },
    f => { f.transactions[1].data = '0x00'; }, f => { f.contract.receipts = async () => ({ verdict: 2n }); }]) {
    const f = await fixture(); mutate(f); await assert.rejects(verifyMainnetOnProvider(archive, artifact, f.provider, f.contract));
  }
});

test('RPC chain ID is read rather than trusting a configured static network', async () => {
  const f = await fixture();
  f.provider.send = async (method, params) => { assert.equal(method, 'eth_chainId'); assert.deepEqual(params, []); return '0x3c8'; };
  await assert.rejects(verifyMainnetOnProvider(archive, artifact, f.provider, f.contract), /不是 BOT 主网 677/);
  f.provider.send = async () => '0x2a5';
  assert.equal((await verifyMainnetOnProvider(archive, artifact, f.provider, f.contract)).chainId, 677);
});

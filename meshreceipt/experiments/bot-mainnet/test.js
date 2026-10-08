import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, Interface, getCreateAddress, keccak256, parseEther } from 'ethers';
import { makeArtifact, prepareBuild } from './serve.js';
import { ACCOUNT, APPROVED_DEPLOYMENT, CAP, CHAIN_ID, FIXED, checkRecordedFees, commitmentKeys, context, enforceBudget, requestFor, runtimeFor, transactionMatches, walletRead } from './protocol.js';

test('scope is exactly the original pavilion PASS; no arbitrary fourth transaction', async () => {
  const artifact = await makeArtifact(), iface = new Interface(artifact.abi), target = '0x0000000000000000000000000000000000000001';
  const registration = iface.parseTransaction(await requestFor(1, artifact, target)), receipt = iface.parseTransaction(await requestFor(2, artifact, target));
  assert.equal(registration.name, 'registerTask'); assert.equal(receipt.name, 'recordReceipt');
  assert.equal(receipt.args[1], commitmentKeys().attempt); assert.equal(receipt.args[2], FIXED.provider);
  assert.equal(receipt.args[3], `0x${FIXED.outputHash}`); assert.equal(receipt.args[4], `0x${FIXED.reportHash}`); assert.equal(receipt.args[5], 1n);
  await assert.rejects(requestFor(3, artifact, target));
});
test('budget includes previously spent fees and future reserve, rejects cap and gas overrun', () => {
  const args = { step: 0, spent: 0n, rate: 20_000_000_000n, estimate: 442_000n, balance: parseEther('0.5') };
  assert.ok(enforceBudget(args).totalCeiling < CAP);
  assert.throws(() => enforceBudget({ ...args, rate: 100_000_000_000n }), /0.05/);
  assert.throws(() => enforceBudget({ ...args, spent: parseEther('0.04') }), /0.05/);
  assert.throws(() => enforceBudget({ ...args, balance: 1n }), /余额/);
  assert.throws(() => enforceBudget({ ...args, estimate: 600_000n }), /Gas/);
  assert.throws(() => enforceBudget({ ...args, step: 3 }));
});
test('transaction matching rejects other chains, wallets, values, nonces and payloads', async () => {
  const artifact = await makeArtifact(), req = await requestFor(0, artifact), tx = { chainId: 677n, from: ACCOUNT, to: null, value: 0n, nonce: 7, data: req.data };
  assert.equal(transactionMatches(tx, req, 7), true);
  for (const patch of [{ chainId: 968n }, { value: 1n }, { nonce: 8 }, { data: '0x00' }, { from: FIXED.provider }]) assert.equal(transactionMatches({ ...tx, ...patch }, req, 7), false);
});
function approvedFixture() {
  return { tx: { hash: APPROVED_DEPLOYMENT.hash, nonce: 0, gasLimit: 669_807n, maxFeePerGas: 24_000_000_000n },
    receipt: { status: 1, gasUsed: 441_864n, gasPrice: 24_000_000_000n, fee: parseEther('0.010604736'), blockNumber: 25_878_278 } };
}
// Public screenshot fixture only; not a substitute for a fresh mainnet read.
function registrationFixture() {
  return { tx: { hash: '0x860f9b3af7d690b43f5fb801419f6647305ca3e7e48bdf6d8f3b9e40a3681381',
    nonce: 1, gasLimit: 139_190n, maxFeePerGas: 24_000_000_000n },
    receipt: { status: 1, gasUsed: 91_846n, gasPrice: 24_000_000_000n, fee: parseEther('0.002204304'), blockNumber: 25_880_599 } };
}
test('confirmed registration tolerates wallet gas reserve variance but counts actual execution fees', () => {
  const { tx, receipt } = registrationFixture(), result = checkRecordedFees(1, tx, receipt, APPROVED_DEPLOYMENT.fee);
  assert.equal(result.pending, false); assert.equal(result.approvedRecovery, false);
  assert.equal(result.walletGasLimitVariance, true); assert.equal(result.actualGasWithinLimit, true);
  assert.equal(result.spent, parseEther('0.01280904'));
  const gasUsed = 120_001n;
  assert.throws(() => checkRecordedFees(1, tx, { ...receipt, gasUsed, fee: gasUsed * receipt.gasPrice }, APPROVED_DEPLOYMENT.fee), /实际 Gas/);
});
test('pending gas reserve variance stays pending and cannot be accepted as a confirmed delivery', () => {
  const { tx } = registrationFixture(), result = checkRecordedFees(1, tx, null, APPROVED_DEPLOYMENT.fee);
  assert.equal(result.pending, true); assert.equal(result.spent, APPROVED_DEPLOYMENT.fee);
  assert.equal(result.walletGasLimitVariance, true); assert.equal(result.actualGasWithinLimit, null);
  assert.throws(() => checkRecordedFees(1, tx, null, parseEther('0.049')), /上限/);
});
test('third transaction uses actual gas checks without relaxing signed or cumulative fee caps', () => {
  const tx = { hash: `0x${'ef'.repeat(32)}`, nonce: 2, gasLimit: 250_000n, maxFeePerGas: 24_000_000_000n };
  const receipt = { status: 1, gasUsed: 150_000n, gasPrice: 24_000_000_000n, fee: parseEther('0.0036'), blockNumber: 25_880_600 };
  const spent = parseEther('0.01280904'), result = checkRecordedFees(2, tx, receipt, spent);
  assert.equal(result.pending, false); assert.equal(result.walletGasLimitVariance, true);
  assert.equal(result.actualGasWithinLimit, true); assert.equal(result.spent, spent + receipt.fee);
  const gasUsed = 190_001n;
  assert.throws(() => checkRecordedFees(2, tx, { ...receipt, gasUsed, fee: gasUsed * receipt.gasPrice }, spent), /实际 Gas/);
  assert.throws(() => checkRecordedFees(2, tx, receipt, parseEther('0.045')), /上限/);
  assert.throws(() => checkRecordedFees(2, tx, { ...receipt, status: 0 }, spent), /不自动重试/);
  for (const patch of [{ fee: 1n }, { gasUsed: 250_001n }, { gasUsed: -1n }, { gasPrice: -1n },
    { gasPrice: 25_000_000_000n, fee: receipt.gasUsed * 25_000_000_000n }])
    assert.throws(() => checkRecordedFees(2, tx, { ...receipt, ...patch }, spent));
});
test('only the exact previously signed deployment can recover gas variance; actual fee remains counted', () => {
  const { tx, receipt } = approvedFixture(), result = checkRecordedFees(0, tx, receipt, 0n);
  assert.equal(result.approvedRecovery, true); assert.equal(result.spent, parseEther('0.010604736')); assert.equal(result.pending, false);
  assert.equal(checkRecordedFees(0, tx, null, 0n).pending, true);
  for (const patch of [{ hash: `0x${'ab'.repeat(32)}` }, { gasLimit: 700_000n }, { nonce: 1 }, { maxFeePerGas: 25_000_000_000n }])
    assert.throws(() => checkRecordedFees(0, { ...tx, ...patch }, receipt, 0n));
  assert.throws(() => checkRecordedFees(1, tx, receipt, 0n), /Gas/);
  assert.throws(() => checkRecordedFees(0, tx, receipt, parseEther('0.04')), /上限/);
  for (const patch of [{ status: 0 }, { fee: 1n }, { gasPrice: 20_000_000_000n }, { blockNumber: 123 }, { gasUsed: 440_000n }])
    assert.throws(() => checkRecordedFees(0, tx, { ...receipt, ...patch }, 0n));
});
test('ordinary later transactions distinguish actual gas from unused wallet reserves', () => {
  const tx = { hash: `0x${'cd'.repeat(32)}`, nonce: 1, gasLimit: 110_000n, gasPrice: 20_000_000_000n };
  const receipt = { status: 1, gasUsed: 91_846n, gasPrice: tx.gasPrice, fee: 91_846n * tx.gasPrice, blockNumber: 25_878_279 };
  const result = checkRecordedFees(1, tx, receipt, APPROVED_DEPLOYMENT.fee);
  assert.equal(result.approvedRecovery, false); assert.equal(result.spent, APPROVED_DEPLOYMENT.fee + receipt.fee);
  assert.equal(result.walletGasLimitVariance, false);
  assert.equal(checkRecordedFees(1, { ...tx, gasLimit: 130_000n }, receipt, APPROVED_DEPLOYMENT.fee).walletGasLimitVariance, true);
  assert.throws(() => checkRecordedFees(1, { ...tx, gasLimit: 0n }, receipt, APPROVED_DEPLOYMENT.fee), /无效/);
});
test('readonly wallet adapter cannot send or sign, propagates timeout and does not consume late response', async () => {
  let calls = 0;
  const wallet = { request: async () => { calls++; return '0x2a5'; } };
  for (const method of ['eth_sendTransaction', 'eth_signTransaction', 'personal_sign', 'eth_requestAccounts'])
    assert.throws(() => walletRead(wallet, { method }), /禁止/);
  assert.equal(calls, 0); assert.equal(await walletRead(wallet, { method: 'eth_chainId' }), '0x2a5');
  let settle;
  const stalled = { request: () => new Promise(resolve => { settle = resolve; }) };
  const result = walletRead(stalled, { method: 'eth_getTransactionReceipt' }, 5);
  await assert.rejects(result, /超时/); settle('late'); await assert.rejects(result, /超时/);
});
test('rebuild rejects the repository root instead of deleting or overwriting it', async () => {
  await assert.rejects(prepareBuild(new URL('../../', import.meta.url)), /临时目录/);
});
test('recovery UI migrates the original unknown-hash journal without any wallet call or redeploy button', async () => {
  const artifact = await makeArtifact(), storageKey = 'meshreceipt.mainnet.pavilion.pass-only.v1', elements = new Map();
  const stored = new Map([[storageKey, JSON.stringify({ context: context(artifact), transactions: [], inflight: { step: 0, nonce: 0, hash: null } })]]);
  let walletCalls = 0;
  const globals = ['document', 'window', 'localStorage', '__MAINNET_ARTIFACT__', '__BUNDLE_PROOF__'];
  const descriptors = Object.fromEntries(globals.map(key => [key, Object.getOwnPropertyDescriptor(globalThis, key)]));
  try {
    globalThis.document = { getElementById: key => {
      if (!elements.has(key)) elements.set(key, { textContent: '', disabled: false, value: '', addEventListener() {} });
      return elements.get(key);
    } };
    globalThis.window = { addEventListener() {}, okxwallet: { request: () => { walletCalls++; throw new Error('Unexpected wallet request'); } } };
    globalThis.localStorage = { getItem: key => stored.get(key) ?? null, setItem: (key, value) => stored.set(key, value) };
    globalThis.__MAINNET_ARTIFACT__ = artifact; globalThis.__BUNDLE_PROOF__ = { qualified: true };
    await import('./main.js?recovery-ui-test');
    assert.equal(walletCalls, 0);
    assert.equal(JSON.parse(stored.get(storageKey)).inflight.hash, APPROVED_DEPLOYMENT.hash);
    assert.equal(elements.get('prepare').disabled, true); assert.equal(elements.get('send').disabled, true);
    assert.match(elements.get('prepare').textContent, /禁止重部署/);
    assert.match(elements.get('overview').textContent, /等待重新只读核验/);
  } finally {
    for (const key of globals) { if (descriptors[key]) Object.defineProperty(globalThis, key, descriptors[key]); else delete globalThis[key]; }
  }
});
test('local EVM rehearsal: exact three requests, fixed attester runtime, actual hashes and fees', async t => {
  const local = ganache.provider({ logging: { quiet: true }, chain: { chainId: CHAIN_ID, hardfork: 'shanghai' },
    wallet: { unlockedAccounts: [ACCOUNT] }, miner: { defaultGasPrice: '0x4a817c800' } });
  t.after(() => local.disconnect());
  await local.request({ method: 'evm_setAccountBalance', params: [ACCOUNT, '0x6f05b59d3b20000'] });
  const provider = new BrowserProvider(local, undefined, { cacheTimeout: -1 }), signer = await provider.getSigner(ACCOUNT), artifact = await makeArtifact();
  const receipts = [], gas = [], fees = [];
  let contractAddress = null, spent = 0n;
  for (let step = 0; step < 3; step++) {
    const req = await requestFor(step, artifact, contractAddress), estimate = await provider.estimateGas({ ...req, from: ACCOUNT });
    const budget = enforceBudget({ step, spent, rate: 20_000_000_000n, estimate, balance: await provider.getBalance(ACCOUNT) });
    const tx = await signer.sendTransaction({ ...req, chainId: CHAIN_ID, gasPrice: 20_000_000_000n, gasLimit: budget.gasLimit });
    assert.equal(transactionMatches(await provider.getTransaction(tx.hash), req, step), true);
    const receipt = await tx.wait(); assert.equal(receipt.status, 1); spent += receipt.fee;
    receipts.push(receipt); gas.push(receipt.gasUsed.toString()); fees.push(receipt.fee.toString());
    if (step === 0) contractAddress = receipt.contractAddress;
  }
  assert.equal(contractAddress, getCreateAddress({ from: ACCOUNT, nonce: 0 }));
  assert.equal((await provider.getCode(contractAddress)).toLowerCase(), runtimeFor(artifact).toLowerCase());
  const contract = new ContractFactory(artifact.abi, artifact.bytecode, signer).attach(contractAddress), keys = commitmentKeys();
  assert.equal(await contract.attester(), ACCOUNT);
  assert.equal((await contract.tasks(keys.task)).inputHash, `0x${FIXED.inputHash}`);
  const result = await contract.receipts(keys.attempt);
  assert.equal(result.outputHash, `0x${FIXED.outputHash}`); assert.equal(result.reportHash, `0x${FIXED.reportHash}`); assert.equal(result.verdict, 1n);
  assert.ok(spent < CAP); assert.equal(receipts.length, 3);
  t.diagnostic(JSON.stringify({ simulationOnly: true, gasUsed: gas, feeWeiAt20Gwei: fees, totalFeeWei: spent.toString(), bytecodeHash: keccak256(artifact.bytecode) }));
});

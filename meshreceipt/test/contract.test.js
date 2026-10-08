import test from 'node:test';
import assert from 'node:assert/strict';
import ganache from 'ganache';
import { BrowserProvider, ContractFactory, ZeroAddress, id } from 'ethers';
import { compileRegistry } from '../scripts/compile-contract.js';
import { verifyChainRecords } from '../web/chain-evidence.js';

test('local EVM: authorization, commitments, all verdicts, duplicate and replay guards', async t => {
  const local = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' }, wallet: { totalAccounts: 3 } });
  t.after(() => local.disconnect());
  const provider = new BrowserProvider(local);
  const attester = await provider.getSigner(0), requester = await provider.getSigner(1), other = await provider.getSigner(2);
  const artifact = await compileRegistry();
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, attester);
  await assert.rejects(factory.deploy(ZeroAddress));
  const contract = await factory.deploy(await attester.getAddress()); await contract.waitForDeployment();
  const task = id('task'), input = id('input'), policy = id('policy');
  await (await contract.registerTask(task, input, policy)).wait();
  assert.equal((await contract.tasks(task)).inputHash, input);
  assert.equal((await contract.tasks(task)).requester, await attester.getAddress());
  await assert.rejects(contract.registerTask(task, id('different input'), policy));
  await assert.rejects(contract.connect(other).registerTask(task, id('different input'), policy));
  const args = [task, id('task:attempt'), await other.getAddress(), id('output'), id('report'), 1];
  await assert.rejects(contract.connect(requester).recordReceipt(...args));
  await assert.rejects(contract.recordReceipt(id('unknown task'), ...args.slice(1)));
  await assert.rejects(contract.recordReceipt(...args.slice(0, 5), 0));
  await (await contract.recordReceipt(...args)).wait();
  assert.equal(Number((await contract.receipts(args[1])).verdict), 1);
  const taskView = { id: 'task', inputHash: input.slice(2), policyHash: policy.slice(2), attempts: [
    { id: 'attempt', status: 'COMPLETED', verdict: 'PASS', outputHash: args[3].slice(2), reportHash: args[4].slice(2), delivery: { issuer: args[2] } },
  ] };
  assert.deepEqual(await verifyChainRecords(contract, taskView), { checkedReceipts: 1 });
  await assert.rejects(async () => { const tx = await contract.recordReceipt(...args); await tx.wait(); });
  for (const verdict of [2, 3]) {
    const attempt = id(`task:attempt-${verdict}`);
    await (await contract.recordReceipt(task, attempt, await other.getAddress(), id('output'), id('report'), verdict)).wait();
    assert.equal(Number((await contract.receipts(attempt)).verdict), verdict);
    taskView.attempts.push({ ...taskView.attempts[0], id: `attempt-${verdict}`, verdict: { 2: 'FAIL', 3: 'INCONCLUSIVE' }[verdict] });
  }
  assert.deepEqual(await verifyChainRecords(contract, taskView), { checkedReceipts: 3 });
});

test('local EVM: outsider cannot squat a task ID before authorized registration', async t => {
  const local = ganache.provider({ logging: { quiet: true }, chain: { hardfork: 'shanghai' }, wallet: { totalAccounts: 2 } });
  t.after(() => local.disconnect());
  const provider = new BrowserProvider(local);
  const attester = await provider.getSigner(0), outsider = await provider.getSigner(1);
  const artifact = await compileRegistry();
  const contract = await new ContractFactory(artifact.abi, artifact.bytecode, attester).deploy(await attester.getAddress());
  await contract.waitForDeployment();
  const task = id('reserved-task'), input = id('legitimate-input'), policy = id('legitimate-policy');
  await assert.rejects(contract.connect(outsider).registerTask.staticCall(task, id('wrong-input'), id('wrong-policy')), /not attester/);
  await assert.rejects(async () => {
    const tx = await contract.connect(outsider).registerTask(task, id('wrong-input'), id('wrong-policy'), { gasLimit: 200_000 });
    await tx.wait();
  });
  assert.equal((await contract.tasks(task)).requester, ZeroAddress);
  await (await contract.registerTask(task, input, policy)).wait();
  const registered = await contract.tasks(task);
  assert.equal(registered.requester, await attester.getAddress());
  assert.equal(registered.inputHash, input);
  assert.equal(registered.policyHash, policy);
});

import { Contract, formatEther, getAddress, keccak256 } from 'ethers';
import { ACCOUNT, APPROVED_DEPLOYMENT, CHAIN_ID, EXPLORER, FIXED, checkRecordedFees, commitmentKeys,
  requestFor, runtimeFor, transactionMatches } from '../experiments/bot-mainnet/protocol.js';

export const TRANSACTIONS = Object.freeze([
  APPROVED_DEPLOYMENT.hash,
  '0x860f9b3af7d690b43f5fb801419f6647305ca3e7e48bdf6d8f3b9e40a3681381',
  '0x2f3c601bc576ab344e13af996e0573580ddc292ab7f7d75063075654413b1920',
]);
export const EXPECTED_BYTECODE = '0x2530c6930802e50f7f4c5ee3aa1bba9bd6479348bbb714fcb93bd8d012167856';

function demand(condition, message) { if (!condition) throw new Error(message); }
export function validateMainnetArchive(value) {
  demand(value?.schema === 'meshreceipt.mainnet.pavilion-pass.v1' && value.chainId === CHAIN_ID
    && value.complete === true && getAddress(value.contract) === APPROVED_DEPLOYMENT.contract
    && getAddress(value.account) === ACCOUNT && getAddress(value.attester) === ACCOUNT
    && value.bytecodeHash === EXPECTED_BYTECODE && Number.isFinite(Date.parse(value.checkedAt)), '主网归档的网络、合约或版本不匹配');
  demand(Array.isArray(value.transactions) && value.transactions.length === 3
    && value.transactions.every((tx, i) => tx.hash === TRANSACTIONS[i] && tx.step === i && tx.nonce === i), '归档只允许原三笔交易');
  for (const [key, expected] of Object.entries(FIXED)) demand(value.delivery?.[key] === expected, `归档交付字段不匹配：${key}`);
  return value;
}

export function compareLocalDelivery(archive, bundle, result) {
  validateMainnetArchive(archive);
  demand(result.integrity && result.signatureValid && result.recomputed && result.qualified && result.verdict === 'PASS'
    && result.outputHash === FIXED.outputHash && result.reportHash === FIXED.reportHash && result.manifestHash === FIXED.manifestHash
    && bundle.manifest.task.id === FIXED.taskId && bundle.manifest.attempt.id === FIXED.attemptId
    && bundle.manifest.task.inputHash === FIXED.inputHash && bundle.manifest.task.policyHash === FIXED.policyHash, '原合格包与主网归档不匹配');
}

export async function verifyMainnetOnProvider(archive, artifact, provider, readContract) {
  validateMainnetArchive(archive);
  demand(keccak256(artifact.bytecode) === EXPECTED_BYTECODE, '当前合约源码或编译器与原部署不匹配');
  const chainId = typeof provider.send === 'function'
    ? BigInt(await provider.send('eth_chainId', [])) : (await provider.getNetwork()).chainId;
  demand(chainId === BigInt(CHAIN_ID), '只读节点不是 BOT 主网 677');
  const code = await provider.getCode(archive.contract);
  demand(code.toLowerCase() === runtimeFor(artifact).toLowerCase()
    && keccak256(code) === archive.runtimeHash, '主网运行代码或固定验收者与归档不匹配');
  let spent = 0n;
  const transactions = [];
  for (const [step, hash] of TRANSACTIONS.entries()) {
    const [tx, receipt] = await Promise.all([provider.getTransaction(hash), provider.getTransactionReceipt(hash)]);
    demand(transactionMatches(tx, await requestFor(step, artifact, archive.contract), step), '交易网络、发送者、nonce 或完整调用不匹配');
    demand(receipt && receipt.hash === hash && receipt.status === 1 && receipt.blockNumber === archive.transactions[step].blockNumber,
      '交易未成功入块或区块与归档不匹配');
    if (step === 0) demand(getAddress(receipt.contractAddress) === archive.contract, '部署交易合约地址不匹配');
    const fees = checkRecordedFees(step, tx, receipt, spent); spent = fees.spent;
    demand(receipt.fee.toString() === archive.transactions[step].feeWei, '实际交易费用与归档不匹配');
    transactions.push({ hash, blockNumber: receipt.blockNumber, feeBOT: formatEther(receipt.fee), explorer: `${EXPLORER}/tx/${hash}` });
  }
  demand(spent.toString() === archive.spentWei, '累计费用与归档不匹配');
  const contract = readContract ?? new Contract(archive.contract, artifact.abi, provider);
  demand(getAddress(await contract.attester()) === ACCOUNT, '链上固定验收者不匹配');
  const keys = commitmentKeys(), task = await contract.tasks(keys.task), receipt = await contract.receipts(keys.attempt);
  demand(getAddress(task.requester) === ACCOUNT && task.inputHash === `0x${FIXED.inputHash}` && task.policyHash === `0x${FIXED.policyHash}`, '链上任务与原输入或规则不匹配');
  demand(receipt.taskId === keys.task && getAddress(receipt.provider) === FIXED.provider && receipt.outputHash === `0x${FIXED.outputHash}`
    && receipt.reportHash === `0x${FIXED.reportHash}` && Number(receipt.verdict) === 1, '链上 PASS 与这份交付不匹配');
  return { schema: 'meshreceipt.mainnet-read.v1', status: 'verified-now', checkedAt: new Date().toISOString(), chainId: CHAIN_ID,
    contract: archive.contract, attester: ACCOUNT, transactions, delivery: FIXED, runtimeHash: keccak256(code), spentBOT: formatEther(spent),
    scope: 'single-pavilion-pass', confirmation: 'mined; finality not independently checked' };
}

import { ContractFactory, Interface, getAddress, id, keccak256, parseEther } from 'ethers';

export const CHAIN_ID = 677;
export const RPC = 'https://rpc.botchain.ai';
export const EXPLORER = 'https://scan.botchain.ai';
export const ACCOUNT = getAddress('0x83ecdf7b1ce06b17558a8da188579be2ad2ab512');
export const CAP = parseEther('0.05');
export const GAS_CEILINGS = [600_000n, 120_000n, 190_000n];
export const LABELS = ['部署修复合约', '登记流光亭任务', '登记流光亭 PASS'];
// Human-approved recovery of this already signed deployment only. Not a new gas policy.
export const APPROVED_DEPLOYMENT = Object.freeze({
  hash: '0x3a187ccc117ef8273bfbe74f47b83d0b26a634104437ed735cabca08f4c2289c',
  nonce: 0, contract: getAddress('0x60EFB5EcEeD452d57480Af272F8084c8D0d3c5f7'),
  gasLimit: 669_807n, rate: 24_000_000_000n, gasUsed: 441_864n,
  fee: parseEther('0.010604736'), blockNumber: 25_878_278,
});
export const READ_METHODS = new Set(['eth_chainId', 'eth_accounts', 'net_version', 'eth_blockNumber',
  'eth_getBalance', 'eth_getCode', 'eth_getTransactionCount', 'eth_estimateGas', 'eth_call',
  'eth_getBlockByNumber', 'eth_getBlockByHash', 'eth_getTransactionByHash', 'eth_getTransactionReceipt',
  'eth_gasPrice', 'eth_maxPriorityFeePerGas', 'eth_feeHistory']);
export const FIXED = Object.freeze({
  taskId: 'b1091060-6654-49d9-92e8-31c13b012d82',
  attemptId: '4920e003-d5fe-47e5-99ab-54d5f5f8b06b',
  inputHash: '966eceec3db585ba502d3b92b9ff66f66a9b09c93db760edd487e16fad897b7a',
  policyHash: '81043db65b59cf043370e3dc8ea1601b5f92207e9f0a3b9095eb080aa4d6e003',
  outputHash: 'c9d6d706a6fbab5c634dbe1cdbaf8dc50c5370b35810f46ca39e94fd018e7f23',
  reportHash: 'fdfade8ba89138028aa6ede68201c87d514b93ab91bf384543206cbb2156b91f',
  manifestHash: '18683414b2e7aab6476510e2fda868b459413dc7d8befeebe66c4fcd12d6d7de',
  provider: getAddress('0x89b55cA3dd9F2b5ADd33A61504B3B531589D5c36'),
  instance: '819eea82-7664-4f53-b9cc-101982158359',
  providerId: 'careful-demo', verdict: 1,
});

export function assertThat(condition, message) { if (!condition) throw new Error(message); }
export function commitmentKeys() { return { task: id(FIXED.taskId), attempt: id(`${FIXED.taskId}:${FIXED.attemptId}`) }; }
export async function requestFor(step, artifact, contract) {
  assertThat(Number.isInteger(step) && step >= 0 && step < 3, '授权范围只有三笔交易');
  if (step === 0) return { ...(await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(ACCOUNT)), value: 0n };
  const iface = new Interface(artifact.abi), keys = commitmentKeys();
  const args = step === 1 ? [keys.task, `0x${FIXED.inputHash}`, `0x${FIXED.policyHash}`]
    : [keys.task, keys.attempt, FIXED.provider, `0x${FIXED.outputHash}`, `0x${FIXED.reportHash}`, 1];
  return { to: getAddress(contract), data: iface.encodeFunctionData(step === 1 ? 'registerTask' : 'recordReceipt', args), value: 0n };
}

export function enforceBudget({ step, spent, rate, estimate, balance }) {
  assertThat(Number.isInteger(step) && step >= 0 && step < 3, '已完成授权范围');
  for (const value of [spent, rate, estimate, balance]) assertThat(typeof value === 'bigint' && value >= 0n, '无效费用参数');
  assertThat(rate > 0n && estimate > 0n, '无法读取实际 Gas 估算或价格');
  const gasLimit = (estimate * 120n + 99n) / 100n;
  assertThat(gasLimit <= GAS_CEILINGS[step], 'Gas 估算超出本操作固定安全上限，停止');
  const currentCeiling = gasLimit * rate;
  const futureReserve = GAS_CEILINGS.slice(step + 1).reduce((sum, gas) => sum + gas * rate, 0n);
  assertThat(spent + currentCeiling + futureReserve <= CAP, '已花费用 + 本笔上限 + 后续保守预留超过 0.05 BOT，停止');
  assertThat(balance >= currentCeiling + futureReserve, '当前主网 BOT 余额不足以覆盖本笔及后续预留');
  return { gasLimit, currentCeiling, futureReserve, totalCeiling: spent + currentCeiling + futureReserve };
}

export function runtimeFor(artifact) {
  let code = artifact.runtime.slice(2);
  const slots = Object.values(artifact.immutableReferences).flat();
  assertThat(Object.keys(artifact.immutableReferences).length === 1 && slots.length > 0, '合约 immutable 结构已变化，须重新审查');
  for (const slot of slots) {
    assertThat(slot.length === 32 && slot.start >= 0 && (slot.start + 32) * 2 <= code.length, '无效 immutable 位置');
    const offset = slot.start * 2;
    code = code.slice(0, offset) + ACCOUNT.slice(2).toLowerCase().padStart(64, '0') + code.slice(offset + 64);
  }
  return `0x${code}`;
}

export function context(artifact) { return `${CHAIN_ID}:${ACCOUNT}:${keccak256(artifact.bytecode)}:${FIXED.manifestHash}:pass-only:cap-0.05`; }
export function transactionMatches(tx, request, nonce) {
  return Boolean(tx && tx.chainId === BigInt(CHAIN_ID) && getAddress(tx.from) === ACCOUNT && tx.value === 0n
    && tx.nonce === nonce && tx.data.toLowerCase() === request.data.toLowerCase()
    && (request.to ? tx.to && getAddress(tx.to) === getAddress(request.to) : tx.to === null));
}

export function checkRecordedFees(step, tx, receipt, spent) {
  assertThat(typeof spent === 'bigint' && spent >= 0n && spent <= CAP, '无效累计费用');
  assertThat(Number.isInteger(step) && step >= 0 && step < 3 && tx && typeof tx.gasLimit === 'bigint' && tx.gasLimit > 0n, '无效交易费用');
  const rate = tx.maxFeePerGas ?? tx.gasPrice;
  assertThat(typeof rate === 'bigint' && rate > 0n, '无法核对签署费用');
  const approved = step === 0 && tx.hash?.toLowerCase() === APPROVED_DEPLOYMENT.hash;
  if (approved) {
    assertThat(tx.nonce === 0 && tx.gasLimit === APPROVED_DEPLOYMENT.gasLimit && rate === APPROVED_DEPLOYMENT.rate,
      '已签部署参数与本次特批恢复不符');
  } else if (step === 0) assertThat(tx.gasLimit <= GAS_CEILINGS[step], '非指定部署交易的 Gas 上限不符，停止');
  // A wallet's unused gas reserve is not actual execution. Keep the signed
  // maximum inside the budget, and do not advance before a successful receipt.
  const walletGasLimitVariance = tx.gasLimit > GAS_CEILINGS[step];
  assertThat(spent + tx.gasLimit * rate <= CAP, '签署交易超过总手续费上限，停止');
  if (!receipt) return { approvedRecovery: approved, walletGasLimitVariance, actualGasWithinLimit: null, pending: true, spent };
  assertThat(receipt.status === 1, '交易失败，已消耗费用；不自动重试，须另行授权');
  assertThat(typeof receipt.fee === 'bigint' && receipt.fee >= 0n && typeof receipt.gasUsed === 'bigint' && receipt.gasUsed > 0n
    && typeof receipt.gasPrice === 'bigint' && receipt.gasPrice >= 0n && receipt.gasUsed <= tx.gasLimit
    && receipt.fee === receipt.gasUsed * receipt.gasPrice && receipt.gasPrice <= rate, '交易回执费用无效');
  assertThat(receipt.gasUsed <= GAS_CEILINGS[step], '实际 Gas 消耗超出本操作固定安全上限，停止后续交易');
  if (approved) assertThat(receipt.gasUsed === APPROVED_DEPLOYMENT.gasUsed && receipt.fee === APPROVED_DEPLOYMENT.fee
    && receipt.blockNumber === APPROVED_DEPLOYMENT.blockNumber, '已签部署回执与本次恢复对象不符');
  assertThat(spent + receipt.fee <= CAP, '实际累计费用超过授权上限，停止');
  return { approvedRecovery: approved, walletGasLimitVariance, actualGasWithinLimit: true, pending: false, spent: spent + receipt.fee };
}

/** Only read calls may time out; a timed-out read never writes journal state. */
export function walletRead(wallet, request, timeoutMs = 15_000) {
  assertThat(READ_METHODS.has(request.method), '只读核验器禁止签名或发送交易');
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      const error = new Error(`只读查询 ${request.method} 超时；已签交易不重发，请稍后重新核验`);
      error.code = -32005; reject(error);
    }, timeoutMs);
    Promise.resolve().then(() => wallet.request(request)).then(value => { clearTimeout(timer); resolve(value); }, error => { clearTimeout(timer); reject(error); });
  });
}

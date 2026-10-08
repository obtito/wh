const ADDRESS = /^0x[0-9a-f]{40}$/i, TX_HASH = /^0x[0-9a-f]{64}$/i;

// Cache is untrusted display data, never a source of a fresh-verification flag.
export function parseChainEvidence(value) {
  if (!value || !Number.isSafeInteger(value.network) || value.network <= 0
    || typeof value.contract !== 'string' || !ADDRESS.test(value.contract)
    || !Array.isArray(value.transactions) || value.transactions.length > 32
    || value.transactions.some(hash => typeof hash !== 'string' || !TX_HASH.test(hash))
    || typeof value.checkedAt !== 'string' || value.checkedAt.length > 64 || !Number.isFinite(Date.parse(value.checkedAt))) return null;
  return { network: value.network, contract: value.contract, transactions: [...new Set(value.transactions)], checkedAt: value.checkedAt,
    scope: typeof value.scope === 'string' && value.scope.length <= 8192 ? value.scope : null };
}

export function chainContext(task, config) {
  const attempts = task.attempts.filter(a => a.status === 'COMPLETED')
    .map(a => [a.id, a.delivery?.issuer?.toLowerCase(), a.outputHash, a.reportHash, a.verdict])
    .sort((a, b) => a[0].localeCompare(b[0]));
  return JSON.stringify([config.chainId, config.contractAddress?.toLowerCase(), task.id, task.inputHash, task.policyHash, attempts]);
}

export function chainContextMatches(evidence, task, config) {
  return Boolean(evidence && evidence.network === config.chainId
    && evidence.contract.toLowerCase() === config.contractAddress?.toLowerCase()
    && evidence.scope === chainContext(task, config));
}

export function createChainEvidence(task, config, transactions = []) {
  return parseChainEvidence({ network: config.chainId, contract: config.contractAddress, transactions,
    checkedAt: new Date().toISOString(), scope: chainContext(task, config) });
}

// Read-only: matching a transaction hash/cache alone is not enough. Check each current commitment.
export async function verifyChainRecords(contract, task) {
  const { id, ZeroAddress } = await import('ethers');
  const completed = task.attempts.filter(a => a.status === 'COMPLETED');
  if (!completed.length) throw new Error('没有已完成的验收尝试可供链上核对。');
  const taskId = id(task.id), storedTask = await contract.tasks(taskId);
  if (storedTask.requester === ZeroAddress) throw new Error('链上尚未登记此任务。');
  if (storedTask.inputHash !== `0x${task.inputHash}` || storedTask.policyHash !== `0x${task.policyHash}`) throw new Error('链上任务与本地任务不一致。');
  for (const attempt of completed) {
    const stored = await contract.receipts(id(`${task.id}:${attempt.id}`));
    const verdict = { PASS: 1, FAIL: 2, INCONCLUSIVE: 3 }[attempt.verdict];
    if (!verdict) throw new Error('无法核对运行异常。');
    if (Number(stored.verdict) === 0) throw new Error(`链上尚未记录验收尝试 ${attempt.id}。`);
    if (stored.taskId !== taskId || stored.outputHash !== `0x${attempt.outputHash}` || stored.reportHash !== `0x${attempt.reportHash}`
      || Number(stored.verdict) !== verdict || stored.provider.toLowerCase() !== attempt.delivery.issuer.toLowerCase()) throw new Error('链上尝试与本地尝试不一致。');
  }
  return { checkedReceipts: completed.length };
}

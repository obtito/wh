import { BrowserProvider, Contract, formatEther, formatUnits, getAddress, getCreateAddress, keccak256, toQuantity } from 'ethers';
import { ACCOUNT, APPROVED_DEPLOYMENT, CAP, CHAIN_ID, EXPLORER, FIXED, GAS_CEILINGS, LABELS, RPC, assertThat, checkRecordedFees, commitmentKeys, context, enforceBudget, requestFor, runtimeFor, transactionMatches, walletRead } from './protocol.js';

const artifact = __MAINNET_ARTIFACT__, buildProof = __BUNDLE_PROOF__;
const $ = id => document.getElementById(id), key = 'meshreceipt.mainnet.pavilion.pass-only.v1';
let injected, provider, prepared = null, evidence = null, busy = false, connected = false;
let journal;
try { journal = JSON.parse(localStorage.getItem(key) || 'null'); } catch { journal = { invalid: true }; }
if (!journal) {
  journal = { context: context(artifact), transactions: [], inflight: { step: 0, nonce: 0, hash: APPROVED_DEPLOYMENT.hash } };
  localStorage.setItem(key, JSON.stringify(journal));
} else if (journal.context === context(artifact) && Array.isArray(journal.transactions) && journal.transactions.length === 0
  && (!journal.inflight || journal.inflight.step === 0 && journal.inflight.nonce === 0 && !journal.inflight.hash)) {
  journal.inflight = { step: 0, nonce: 0, hash: APPROVED_DEPLOYMENT.hash };
  localStorage.setItem(key, JSON.stringify(journal));
}
const emptyState = () => ({ step: 0, spent: 0n, contract: null, pending: false });
let state = emptyState();
function status(text) { $('status').textContent = text; }
function assertJournalUnchanged() {
  const stored = localStorage.getItem(key);
  assertThat(stored === null && journal.transactions.length === 0 && !journal.inflight || stored === JSON.stringify(journal), '另一个页面改变了发送记录，请重新连接，禁止重复签名');
}
function save() { localStorage.setItem(key, JSON.stringify(journal)); }
function invalidate(message) { prepared = null; connected = false; evidence = null; $('evidence').textContent = '账户或网络改变，旧信息不是本次核验。'; status(message); render(); }
function render() {
  $('network').disabled = $('connect').disabled = busy;
  $('refresh').disabled = busy || !connected;
  $('prepare').disabled = busy || !connected || state.pending || !!journal.inflight || state.step === 0 || state.step >= 3;
  $('send').disabled = busy || !connected || !prepared || state.pending || !!journal.inflight;
  $('recover').disabled = busy || !connected || !journal.inflight || !!journal.inflight.hash;
  $('download').disabled = busy || !evidence;
  $('prepare').textContent = state.step === 0 ? '先只读恢复已签部署（禁止重部署）'
    : state.step < 3 ? `预估第 ${state.step + 1} 笔：${LABELS[state.step]}（不发送）` : '三笔授权交易已核验';
  $('send').textContent = prepared ? `本人发起第 ${prepared.step + 1} 笔 OKX 签名` : '本人发起下一笔签名';
}
async function guard() {
  assertThat(injected?.request, '请使用装有 OKX Wallet 的 Chrome');
  const actual = BigInt(await walletRead(injected, { method: 'eth_chainId' }));
  assertThat(actual === BigInt(CHAIN_ID), `钱包当前 Chain ID ${actual}，不是 BOT 主网 677`);
  const accounts = await walletRead(injected, { method: 'eth_accounts' });
  assertThat(accounts.length > 0 && getAddress(accounts[0]) === ACCOUNT, '当前钱包不是授权部署和验收地址');
  assertThat((await provider.getNetwork()).chainId === BigInt(CHAIN_ID), '钱包 RPC 网络不一致');
}
async function chooseNetwork() {
  const wallet = window.okxwallet;
  assertThat(wallet?.request, '未检测到 OKX Wallet；不会回退到其他钱包');
  try { await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2a5' }] }); }
  catch (error) {
    if (Number(error.code) !== 4902) throw error;
    await wallet.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x2a5', chainName: 'BOT Chain Mainnet', nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 }, rpcUrls: [RPC], blockExplorerUrls: [EXPLORER] }] });
    await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x2a5' }] });
  }
  invalidate('请核对 OKX 中的主网 677，再连接钱包。');
}
async function connect() {
  injected = window.okxwallet;
  assertThat(injected?.request, '未检测到 OKX Wallet；请在安装该扩展的 Chrome 中打开');
  await injected.request({ method: 'eth_requestAccounts' });
  provider = new BrowserProvider({ request: request => walletRead(injected, request) }, undefined, { cacheTimeout: -1 });
  await guard();
  connected = true;
  injected.on?.('chainChanged', () => invalidate('网络改变，请重新连接并复核。'));
  injected.on?.('accountsChanged', () => invalidate('账户改变，请重新连接并复核。'));
  await refresh();
}
async function checkContract(address) {
  const code = await provider.getCode(address);
  assertThat(code.toLowerCase() === runtimeFor(artifact).toLowerCase(), '主网运行代码与修复源码及指定验收者不符');
  const contract = new Contract(address, artifact.abi, provider);
  assertThat(getAddress(await contract.attester()) === ACCOUNT, '链上验收者不符');
  return contract;
}
async function refresh() {
  status('正在只读查询已有交易、运行代码、验收者和费用；不会发送交易。');
  prepared = null; evidence = null; await guard();
  assertJournalUnchanged();
  assertThat(journal.context === context(artifact) && Array.isArray(journal.transactions) && journal.transactions.length <= 3, '恢复缓存与本次授权范围不符；不要重新发送');
  state = emptyState();
  const all = [...journal.transactions];
  if (journal.inflight?.hash) all.push(journal.inflight);
  assertThat(all[0]?.hash?.toLowerCase() === APPROVED_DEPLOYMENT.hash, '首笔不是已授权恢复的部署交易，禁止重部署或替换');
  const seen = new Set(), records = [];
  for (let step = 0; step < all.length; step++) {
    const entry = all[step];
    assertThat(entry.step === step && Number.isSafeInteger(entry.nonce) && /^0x[0-9a-f]{64}$/i.test(entry.hash) && !seen.has(entry.hash), '交易恢复缓存无效');
    seen.add(entry.hash);
    const tx = await provider.getTransaction(entry.hash), req = await requestFor(step, artifact, state.contract);
    assertThat(transactionMatches(tx, req, entry.nonce), '主网交易与授权地址、链、操作数据或 nonce 不一致');
    const receipt = await provider.getTransactionReceipt(entry.hash);
    const fees = checkRecordedFees(step, tx, receipt, state.spent);
    if (fees.pending) { state.pending = true; break; }
    const fee = receipt.fee;
    state.spent = fees.spent;
    if (step === 0) {
      assertThat(receipt.contractAddress && getAddress(receipt.contractAddress) === getCreateAddress({ from: ACCOUNT, nonce: entry.nonce }), '部署地址不符');
      state.contract = getAddress(receipt.contractAddress);
      assertThat(state.contract === APPROVED_DEPLOYMENT.contract, '恢复的主网合约地址与已签部署不符');
      await checkContract(state.contract);
    }
    records.push({ step, operation: LABELS[step], hash: entry.hash, nonce: entry.nonce, blockNumber: receipt.blockNumber,
      gasUsed: receipt.gasUsed.toString(), gasLimit: tx.gasLimit.toString(), gasPriceWei: receipt.gasPrice.toString(), feeWei: fee.toString(), feeBOT: formatEther(fee),
      approvedRecovery: fees.approvedRecovery, walletGasLimitVariance: fees.walletGasLimitVariance, actualGasWithinLimit: fees.actualGasWithinLimit,
      actualGasCeiling: GAS_CEILINGS[step].toString(), signedMaximumFeeWei: (tx.gasLimit * (tx.maxFeePerGas ?? tx.gasPrice)).toString(),
      explorer: `${EXPLORER}/tx/${entry.hash}` });
    state.step = step + 1;
  }
  if (state.contract) {
    const contract = await checkContract(state.contract), keys = commitmentKeys();
    if (state.step >= 2) {
      const task = await contract.tasks(keys.task);
      assertThat(getAddress(task.requester) === ACCOUNT && task.inputHash === `0x${FIXED.inputHash}` && task.policyHash === `0x${FIXED.policyHash}`, '链上任务哈希与交付包不一致');
    }
    if (state.step === 3) {
      const receipt = await contract.receipts(keys.attempt);
      assertThat(receipt.taskId === keys.task && getAddress(receipt.provider) === FIXED.provider && receipt.outputHash === `0x${FIXED.outputHash}`
        && receipt.reportHash === `0x${FIXED.reportHash}` && Number(receipt.verdict) === 1, '链上 PASS 与固定交付包不一致');
    }
  }
  if (!state.pending && journal.inflight?.hash && state.step === all.length) {
    journal.transactions.push(journal.inflight); journal.inflight = null; save();
  }
  const balance = await provider.getBalance(ACCOUNT), block = await provider.getBlockNumber();
  const reserveVariance = records.filter(record => record.walletGasLimitVariance).map(record => record.step + 1);
  $('overview').textContent = `实时读取：主网 677 · 区块 ${block}\n部署钱包 = 验收者：${ACCOUNT}\n余额：${formatEther(balance)} BOT\n已核验 ${state.step}/3 笔；累计实际费用 ${formatEther(state.spent)} BOT\n${state.contract ? `合约：${state.contract}` : '尚无经本页核验的主网合约'}${reserveVariance.length ? `\n第 ${reserveVariance.join('、')} 笔钱包 Gas 预留较高；实际消耗、费用及签署最高费用均已核对。` : ''}`;
  evidence = { schema: 'meshreceipt.mainnet.pavilion-pass.v1', checkedAt: new Date().toISOString(), chainId: CHAIN_ID, rpc: RPC,
    account: ACCOUNT, attester: ACCOUNT, feeCapBOT: '0.05', spentWei: state.spent.toString(), contract: state.contract,
    feeValidation: 'confirmed actual gas and fees; pending and confirmed signed maximum also checked against cap',
    complete: state.step === 3, confirmation: 'mined; finality not independently checked', transactions: records,
    delivery: FIXED, bundleVerificationAtBuild: buildProof, compiler: artifact.compiler, evmVersion: 'paris', bytecodeHash: keccak256(artifact.bytecode),
    runtimeHash: keccak256(runtimeFor(artifact)), note: '事后可信验收者声明；只记录这一份 PASS，不包含原任务的 FAIL；不证明视觉质量、版权或服务独立性。' };
  $('evidence').textContent = JSON.stringify(evidence, null, 2);
  $('links').replaceChildren();
  for (const item of records) { const a = document.createElement('a'); a.href = item.explorer; a.target = '_blank'; a.rel = 'noopener'; a.textContent = `${item.operation} ↗ `; $('links').append(a); }
  status(state.step === 3 ? '三笔交易及交付哈希本次链上复核通过。请保存证据；最终性尚未独立检查。'
    : state.pending || journal.inflight ? '存在待确认或发送结果不明的交易，禁止重复发送。' : '主网及账户读取成功。可预估下一笔；这一步不发送交易。');
}
async function prepare() {
  await refresh();
  assertThat(!state.pending && !journal.inflight && state.step > 0 && state.step < 3, '必须先恢复已签部署；本页禁止重新部署');
  const latest = await provider.getTransactionCount(ACCOUNT, 'latest'), pending = await provider.getTransactionCount(ACCOUNT, 'pending');
  assertThat(latest === pending, '钱包还有其他待确认交易；请先处理，避免 nonce 冲突');
  const req = await requestFor(state.step, artifact, state.contract);
  const estimate = await provider.estimateGas({ ...req, from: ACCOUNT });
  const fee = await provider.getFeeData(), rate = fee.maxFeePerGas ?? fee.gasPrice;
  assertThat(rate != null, '无法获取费用');
  const fees = fee.maxFeePerGas != null ? { maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 0n } : { gasPrice: fee.gasPrice };
  const budget = enforceBudget({ step: state.step, spent: state.spent, rate, estimate, balance: await provider.getBalance(ACCOUNT) });
  prepared = { step: state.step, at: Date.now(), nonce: latest, budget, req: { ...req, ...fees, nonce: latest, chainId: CHAIN_ID, gasLimit: budget.gasLimit, value: 0n } };
  $('review').textContent = `第 ${state.step + 1}/3 笔：${LABELS[state.step]}\n主网 677 · ${ACCOUNT}\n目标：${req.to || '创建 MeshReceiptRegistry 合约'}\n转账：0 BOT\n预计 Gas：${estimate}；发送 Gas 上限：${budget.gasLimit}\n最高费用单价：${formatUnits(rate, 'gwei')} Gwei\n本笔费用上限：${formatEther(budget.currentCeiling)} BOT\n后续保守预留：${formatEther(budget.futureReserve)} BOT\n已花 + 本笔 + 后续：${formatEther(budget.totalCeiling)} BOT ≤ 0.05 BOT\nnonce：${latest}\n请本人核对 OKX 的链、地址、0 BOT 和费用。勿改 Gas 参数。\n估算 60 秒后失效，发送前仍会重新检查。`;
  status('费用核实通过，尚未发送。下一按钮只向 OKX 请求这一笔，由你本人确认。');
}
async function send() {
  assertThat(prepared && Date.now() - prepared.at < 60_000, '参数未准备或已过期，请重新预估');
  const selected = prepared;
  assertThat(selected.step === 1 || selected.step === 2, '恢复页只允许第二、第三笔，禁止重新部署');
  await guard();
  await refresh();
  assertThat(state.step === selected.step && !state.pending && !journal.inflight, '链上进度改变，请重新预估');
  assertThat(await provider.getTransactionCount(ACCOUNT, 'pending') === selected.nonce && await provider.getTransactionCount(ACCOUNT, 'latest') === selected.nonce, 'nonce 改变，请重新预估');
  const estimate = await provider.estimateGas({ ...selected.req, from: ACCOUNT });
  assertThat(estimate <= selected.req.gasLimit, '发送前 Gas 估算升高，请重新预估');
  const rate = selected.req.maxFeePerGas ?? selected.req.gasPrice;
  const currentCeiling = selected.req.gasLimit * rate;
  const futureReserve = GAS_CEILINGS.slice(selected.step + 1).reduce((sum, gas) => sum + gas * rate, 0n);
  assertThat(state.spent + currentCeiling + futureReserve <= CAP && await provider.getBalance(ACCOUNT) >= currentCeiling + futureReserve, '发送前预算或余额检查失败，请重新预估');
  // Persist before asking the wallet; uncertain broadcast must never be auto-retried.
  assertJournalUnchanged();
  journal.inflight = { step: selected.step, nonce: selected.nonce, hash: null }; save();
  prepared = null;
  status('请本人在 OKX 核对并确认这一笔；拒绝会停止。不要修改 Gas 参数。');
  try {
    // Get and persist the wallet's hash directly; do not let ethers poll forever
    // for getTransaction before preserving an already-broadcast transaction.
    const req = selected.req;
    const rpcTx = { from: ACCOUNT, to: req.to, data: req.data, chainId: toQuantity(CHAIN_ID), value: '0x0',
      nonce: toQuantity(req.nonce), gas: toQuantity(req.gasLimit) };
    if (req.maxFeePerGas != null) {
      rpcTx.maxFeePerGas = toQuantity(req.maxFeePerGas); rpcTx.maxPriorityFeePerGas = toQuantity(req.maxPriorityFeePerGas);
    } else rpcTx.gasPrice = toQuantity(req.gasPrice);
    const hash = await injected.request({ method: 'eth_sendTransaction', params: [rpcTx] });
    assertThat(typeof hash === 'string' && /^0x[0-9a-f]{64}$/i.test(hash), '钱包未返回有效交易哈希；禁止重复发送');
    journal.inflight.hash = hash; save();
    $('recoverHash').value = hash;
    status(`已返回交易哈希 ${hash}，等候入块；不要重复发送。`);
    await refresh();
  } catch (error) {
    const rejection = error.code === 'ACTION_REJECTED' || Number(error.code) === 4001 || Number(error.info?.error?.code) === 4001;
    if (rejection && !journal.inflight?.hash) { journal.inflight = null; save(); }
    throw error;
  }
}
async function recover() {
  await guard(); assertJournalUnchanged();
  assertThat(journal.inflight && !journal.inflight.hash && /^0x[0-9a-f]{64}$/i.test($('recoverHash').value.trim()), '需要已有发送意图及有效交易哈希');
  const hash = $('recoverHash').value.trim(), tx = await provider.getTransaction(hash);
  assertThat(transactionMatches(tx, await requestFor(journal.inflight.step, artifact, state.contract), journal.inflight.nonce), '恢复交易不属于本次授权操作');
  journal.inflight.hash = hash; save(); await refresh();
}
window.addEventListener('storage', event => {
  if (event.key !== key) return;
  invalidate('其他标签页改变了交易记录，请重新打开本页并复核；禁止重复签名。');
});
async function run(action) {
  if (busy) return; busy = true; render();
  try { await action(); }
  catch (error) { prepared = null; evidence = null; $('evidence').textContent = '本次核验未通过，旧显示不得作为成功证据。'; status(error.info?.error?.message || error.shortMessage || error.message); }
  finally { busy = false; render(); }
}
for (const [name, action] of Object.entries({ network: chooseNetwork, connect, refresh, prepare, send, recover })) $(name).addEventListener('click', () => run(action));
$('download').addEventListener('click', () => {
  if (!evidence) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }));
  const a = document.createElement('a'); a.href = url; a.download = `meshreceipt-mainnet-pavilion-${evidence.complete ? 'complete' : 'partial'}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});
$('scope').textContent = JSON.stringify({ authorizedTransactions: LABELS, recoveryDeploymentHash: APPROVED_DEPLOYMENT.hash, account: ACCOUNT, capBOT: formatEther(CAP), delivery: FIXED,
  compiler: artifact.compiler, evmVersion: 'paris', optimizerRuns: 200, bytecodeHash: keccak256(artifact.bytecode), bundleVerificationAtBuild: buildProof }, null, 2);
$('overview').textContent = `冻结账户：${ACCOUNT}\n目标主网：677\n已有部署 ${APPROVED_DEPLOYMENT.hash}\n等待重新只读核验，禁止重部署。`;
$('recoverHash').value = journal.inflight?.hash || APPROVED_DEPLOYMENT.hash;
if (journal.transactions?.length || journal.inflight) status('检测到历史发送记录。连接后必须重新链上核验，不会自动再发。');
render();

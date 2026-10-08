import { BrowserProvider, Contract, ContractFactory, formatEther, getAddress, keccak256, ZeroAddress } from 'ethers';

const artifact = __REGISTRY__;
const chainId = 968;
const networkName = 'BOT Chain Testnet';
const currency = '测试 BOT';
const explorer = 'https://scan.bohr.life';
const storageKey = 'meshreceipt.bot-testnet.deploy';
const $ = id => document.getElementById(id);
$('attester').value = __ATTESTER__;
$('compiler').textContent = `Solidity ${artifact.compiler}\nEVM: ${artifact.evmVersion}\nOptimizer: enabled, runs 200\nBytecode keccak256: ${keccak256(artifact.bytecode)}`;
let injected, provider, signer, account, prepared, evidence, busy = false, pendingHash = null;
function invalidate() {
  prepared = null;
  $('deploy').disabled = true;
  $('prepare').disabled = !signer || busy || !!pendingHash;
}
function status(message) { $('status').textContent = message; }
async function checkNetwork() {
  if (Number(await injected.request({ method: 'eth_chainId' })) !== chainId) throw new Error('请在钱包中切换到 BOT Chain / Bohr Testnet（968），然后重新连接。');
  const accounts = await injected.request({ method: 'eth_accounts' });
  if (!accounts.length || getAddress(accounts[0]) !== account) throw new Error('钱包账户已改变，请重新连接。');
}
async function addNetwork() {
  const wallet = window.okxwallet || window.ethereum;
  if (!wallet?.request) throw new Error('未检测到钱包扩展，请在安装 OKX / MetaMask 的 Chrome 中打开本页。');
  try {
    await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x3c8' }] });
  } catch (error) {
    if (Number(error.code) !== 4902) throw error;
    await wallet.request({ method: 'wallet_addEthereumChain', params: [{ chainId: '0x3c8', chainName: networkName, nativeCurrency: { name: 'BOT', symbol: 'BOT', decimals: 18 }, rpcUrls: ['https://rpc.bohr.life'], blockExplorerUrls: [explorer] }] });
    await wallet.request({ method: 'wallet_switchEthereumChain', params: [{ chainId: '0x3c8' }] });
  }
  signer = null;
  invalidate();
  status('请检查钱包中的网络为 BOT 测试网（968），再连接钱包。');
}
async function connect() {
  signer = null;
  invalidate();
  injected = window.okxwallet || window.ethereum;
  if (!injected?.request) throw new Error('未检测到钱包扩展，请在安装 OKX / MetaMask 的 Chrome 中打开。');
  await injected.request({ method: 'eth_requestAccounts' });
  provider = new BrowserProvider(injected);
  const connectedSigner = await provider.getSigner();
  account = await connectedSigner.getAddress();
  await checkNetwork();
  if (!$('attester').value.trim()) $('attester').value = account;
  if (getAddress($('attester').value.trim()) !== account) throw new Error('当前钱包与验收者地址不同，请切换到指定钱包账户。');
  signer = connectedSigner;
  injected.on?.('chainChanged', () => { signer = null; invalidate(); status('网络已改变，请重新连接。'); });
  injected.on?.('accountsChanged', () => { signer = null; invalidate(); status('账户已改变，请重新连接。'); });
  $('review').textContent = `网络：${networkName} (${chainId})\n部署钱包：${account}\n余额：${formatEther(await provider.getBalance(account))} ${currency}\n验收者：${getAddress($('attester').value.trim())}`;
  invalidate();
  status('连接检查通过。下一步只估算费用，不发送交易。');
}
async function prepare() {
  invalidate();
  await checkNetwork();
  const attester = getAddress($('attester').value.trim());
  if (attester === ZeroAddress || attester !== account) throw new Error('验收者必须是当前指定钱包账户。');
  const factory = new ContractFactory(artifact.abi, artifact.bytecode, signer);
  const request = await factory.getDeployTransaction(attester);
  const estimate = await provider.estimateGas({ ...request, from: account });
  const gasLimit = (estimate * 120n + 99n) / 100n;
  if (gasLimit > 1500000n) throw new Error('部署 Gas 超出本合约预期，停止提交。');
  const fee = await provider.getFeeData();
  const rate = fee.maxFeePerGas ?? fee.gasPrice;
  if (rate == null) throw new Error('钱包没有返回 Gas 价格。');
  const fees = fee.maxFeePerGas != null ? { maxFeePerGas: fee.maxFeePerGas, maxPriorityFeePerGas: fee.maxPriorityFeePerGas ?? 0n } : { gasPrice: fee.gasPrice };
  const ceiling = gasLimit * rate;
  if (await provider.getBalance(account) < ceiling) throw new Error('BOT 测试网余额不足，请先通过官方水龙头领取测试 BOT。');
  prepared = { request: { ...request, ...fees, gasLimit, value: 0n, chainId }, attester };
  $('review').textContent = `网络：${networkName} (${chainId})\n部署钱包：${account}\n固定验收者：${attester}\n转账：0 BOT\n预计 Gas：${estimate}\nGas 上限：${gasLimit}\n按当前费用参数计算的费用上限：${formatEther(ceiling)} ${currency}\n合约：MeshReceiptRegistry\n请本人核对钱包弹窗并确认。`;
  status('部署参数已准备好，尚未发送交易。');
}
async function verify(hash) {
  await checkNetwork();
  if (!/^0x[\da-f]{64}$/i.test(hash)) throw new Error('交易哈希格式不正确。');
  const receipt = await provider.getTransactionReceipt(hash);
  if (!receipt) throw new Error('交易仍在等待确认，请稍后查询。');
  if (receipt.status !== 1 || !receipt.contractAddress) throw new Error('这不是成功的合约部署交易。');
  const attester = getAddress($('attester').value.trim());
  const transaction = await provider.getTransaction(hash);
  const expected = await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(attester);
  if (!transaction || transaction.to !== null || transaction.data !== expected.data || transaction.value !== 0n || getAddress(transaction.from) !== account) throw new Error('部署交易与本合约、验收者或当前账户不一致。');
  const code = await provider.getCode(receipt.contractAddress);
  if (code === '0x') throw new Error('合约地址没有代码。');
  const contract = new Contract(receipt.contractAddress, artifact.abi, provider);
  if (getAddress(await contract.attester()) !== attester) throw new Error('链上验收者不一致。');
  evidence = { schema: 'meshreceipt.testnet-deployment.v1', network: networkName, chainId, rpc: 'https://rpc.bohr.life', contract: receipt.contractAddress, attester, deployer: receipt.from, transaction: hash, blockNumber: receipt.blockNumber, compiler: artifact.compiler, evmVersion: artifact.evmVersion, optimizerRuns: 200, bytecodeHash: keccak256(artifact.bytecode), runtimeHash: keccak256(code), explorer: `${explorer}/tx/${hash}` };
  $('evidence').textContent = JSON.stringify(evidence, null, 2);
  $('explorer').href = evidence.explorer;
  $('config').value = `MESHRECEIPT_CHAIN_ID=${chainId}\nMESHRECEIPT_CONTRACT_ADDRESS=${evidence.contract}`;
  $('result').hidden = false;
  status('链上部署、交易输入和验收者已核对成功。请保存证据，再将合约地址接回应用。');
  pendingHash = hash;
  invalidate();
}
async function deploy() {
  if (!prepared) throw new Error('请先预估部署费用。');
  await checkNetwork();
  const deployment = prepared;
  if (getAddress($('attester').value.trim()) !== deployment.attester) throw new Error('验收者已改变，请重新预估。');
  prepared = null;
  status('请本人在钱包里核对 BOT 测试网（968）、金额 0 和测试 BOT 费用，并确认部署。');
  const tx = await signer.sendTransaction(deployment.request);
  pendingHash = tx.hash;
  $('txHash').value = tx.hash;
  sessionStorage.setItem(storageKey, tx.hash);
  status(`已发送 ${tx.hash}，等待链上确认；请勿重复部署。`);
  await tx.wait(1);
  await verify(tx.hash);
}
async function run(action) {
  if (busy) return;
  busy = true;
  $('network').disabled = $('connect').disabled = $('prepare').disabled = $('deploy').disabled = $('verify').disabled = true;
  try { await action(); } catch (error) { status(error.shortMessage || error.message); }
  finally {
    busy = false;
    $('network').disabled = $('connect').disabled = $('verify').disabled = false;
    $('prepare').disabled = !signer || !!pendingHash;
    $('deploy').disabled = !prepared || !!pendingHash;
  }
}
$('network').addEventListener('click', () => run(addNetwork));
$('connect').addEventListener('click', () => run(connect));
$('prepare').addEventListener('click', () => run(prepare));
$('deploy').addEventListener('click', () => run(deploy));
$('verify').addEventListener('click', () => run(() => verify($('txHash').value.trim())));
$('attester').addEventListener('input', invalidate);
$('txHash').value = sessionStorage.getItem(storageKey) || '';
if ($('txHash').value) { pendingHash = $('txHash').value; status('检测到已有部署交易。连接钱包后查询交易，避免重复部署。'); }
$('download').addEventListener('click', () => {
  if (!evidence) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(evidence, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a'); link.href = url; link.download = 'meshreceipt-bot-testnet-deployment.json'; link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
});

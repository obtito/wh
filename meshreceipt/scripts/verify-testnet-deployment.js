import { Contract, ContractFactory, FetchRequest, JsonRpcProvider, formatEther, getAddress, keccak256 } from 'ethers';
import { mkdir, writeFile } from 'node:fs/promises';
import { compileRegistry } from './compile-contract.js';

const [hash, rawAttester] = process.argv.slice(2);
if (!/^0x[\da-f]{64}$/i.test(hash || '') || !rawAttester) throw new Error('Usage: node scripts/verify-testnet-deployment.js TRANSACTION_HASH ATTESTER_ADDRESS');
const attester = getAddress(rawAttester);
const request = new FetchRequest('https://rpc.bohr.life');
request.timeout = 12000;
const provider = new JsonRpcProvider(request);
try {
  const network = await provider.getNetwork();
  if (network.chainId !== 968n) throw new Error(`Wrong chain: ${network.chainId}`);
  const [tx, receipt, artifact] = await Promise.all([provider.getTransaction(hash), provider.getTransactionReceipt(hash), compileRegistry()]);
  if (!receipt || receipt.status !== 1 || !receipt.contractAddress) throw new Error('Deployment is not confirmed successfully.');
  const expected = await new ContractFactory(artifact.abi, artifact.bytecode).getDeployTransaction(attester);
  if (!tx || tx.to !== null || tx.chainId !== 968n || tx.data !== expected.data || tx.value !== 0n || getAddress(tx.from) !== attester) throw new Error('Deployment transaction does not match the local contract and intended attester.');
  const code = await provider.getCode(receipt.contractAddress);
  if (code === '0x') throw new Error('No deployed code.');
  const contract = new Contract(receipt.contractAddress, artifact.abi, provider);
  if (getAddress(await contract.attester()) !== attester) throw new Error('Wrong attester on chain.');
  const evidence = {
    schema: 'meshreceipt.testnet-deployment.v1', network: 'BOT Chain Testnet', chainId: 968,
    rpc: 'https://rpc.bohr.life', contract: receipt.contractAddress, attester, deployer: receipt.from,
    transaction: hash, blockNumber: receipt.blockNumber, gasUsed: receipt.gasUsed.toString(),
    gasPriceWei: receipt.gasPrice.toString(), feeBOT: formatEther(receipt.fee),
    compiler: artifact.compiler, evmVersion: artifact.evmVersion, optimizerRuns: 200,
    bytecodeHash: keccak256(artifact.bytecode), runtimeHash: keccak256(code),
    explorer: `https://scan.bohr.life/tx/${hash}`, verified: { chain: true, transactionInput: true, deployedCode: true, attester: true },
  };
  const directory = new URL('../data/deployments/', import.meta.url);
  await mkdir(directory, { recursive: true });
  await writeFile(new URL(`bot-testnet-${hash}.json`, directory), JSON.stringify(evidence, null, 2) + '\n');
  console.log(JSON.stringify(evidence, null, 2));
} finally { provider.destroy(); }

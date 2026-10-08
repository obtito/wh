import { readFile, mkdir, writeFile } from 'node:fs/promises';
import solc from 'solc';

export async function compileRegistry() {
  const content = await readFile(new URL('../contracts/MeshReceiptRegistry.sol', import.meta.url), 'utf8');
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'MeshReceiptRegistry.sol': { content } },
    settings: { optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } } } })));
  const errors = (output.errors ?? []).filter(item => item.severity === 'error');
  if (errors.length) throw new Error(errors.map(error => error.formattedMessage).join('\n'));
  const contract = output.contracts['MeshReceiptRegistry.sol'].MeshReceiptRegistry;
  return { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}`, runtime: `0x${contract.evm.deployedBytecode.object}`,
    immutableReferences: contract.evm.deployedBytecode.immutableReferences, compiler: solc.version(), evmVersion: 'paris' };
}
if (process.argv[1]?.endsWith('/compile-contract.js')) {
  const artifact = await compileRegistry();
  const directory = new URL('../data/contracts/', import.meta.url); await mkdir(directory, { recursive: true });
  await writeFile(new URL('MeshReceiptRegistry.json', directory), JSON.stringify(artifact, null, 2));
  console.log(`Compiled MeshReceiptRegistry with ${artifact.compiler}; EVM target=${artifact.evmVersion}. No transaction sent.`);
}

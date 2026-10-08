import { readFile, mkdtemp, realpath, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createServer } from 'node:http';
import { build } from 'vite';
import solc from 'solc';
import { keccak256 } from 'ethers';
import { verifyBundle, readBoundedFile, MAX_BUNDLE_BYTES, parseBundle } from '../../src/bundle.js';
import { FIXED, assertThat } from './protocol.js';

export async function makeArtifact() {
  const content = await readFile(new URL('../../contracts/MeshReceiptRegistry.sol', import.meta.url), 'utf8');
  const output = JSON.parse(solc.compile(JSON.stringify({ language: 'Solidity', sources: { 'MeshReceiptRegistry.sol': { content } }, settings: {
    optimizer: { enabled: true, runs: 200 }, evmVersion: 'paris', outputSelection: { '*': { '*': ['abi', 'evm.bytecode.object', 'evm.deployedBytecode.object', 'evm.deployedBytecode.immutableReferences'] } },
  } })));
  const errors = (output.errors || []).filter(error => error.severity === 'error');
  assertThat(!errors.length, errors.map(error => error.formattedMessage).join('\n'));
  const contract = output.contracts['MeshReceiptRegistry.sol'].MeshReceiptRegistry;
  const artifact = { abi: contract.abi, bytecode: `0x${contract.evm.bytecode.object}`, runtime: `0x${contract.evm.deployedBytecode.object}`,
    immutableReferences: contract.evm.deployedBytecode.immutableReferences, compiler: solc.version() };
  assertThat(keccak256(artifact.bytecode) === '0x2530c6930802e50f7f4c5ee3aa1bba9bd6479348bbb714fcb93bd8d012167856', '源码或编译器已变化，须先重新审查，不能沿用本次授权');
  return artifact;
}
export async function prepareBuild(output) {
  const actual = await realpath(output), temporaryRoot = await realpath(tmpdir());
  assertThat(path.dirname(actual) === temporaryRoot && /^meshreceipt-mainnet-signing-[A-Za-z0-9]+$/.test(path.basename(actual))
    && (await stat(actual)).isDirectory(), '只允许构建到此工具创建的独立临时目录');
  const bundlePath = new URL('../../data/handoffs/b1091060-6654-49d9-92e8-31c13b012d82/bundles/meshreceipt-qualified-b1091060-6654-49d9-92e8-31c13b012d82-4920e003-d5fe-47e5-99ab-54d5f5f8b06b.json', import.meta.url);
  const bundle = parseBundle(await readBoundedFile(bundlePath, MAX_BUNDLE_BYTES));
  const { result } = await verifyBundle(bundle, { issuer: FIXED.provider, instance: FIXED.instance, providerId: FIXED.providerId });
  assertThat(result.qualified && result.verdict === 'PASS' && result.manifestHash === FIXED.manifestHash
    && result.outputHash === FIXED.outputHash && result.reportHash === FIXED.reportHash
    && bundle.manifest.task.id === FIXED.taskId && bundle.manifest.attempt.id === FIXED.attemptId
    && bundle.manifest.task.inputHash === FIXED.inputHash && bundle.manifest.task.policyHash === FIXED.policyHash, '交付包不再匹配已授权快照');
  const artifact = await makeArtifact();
  await build({ configFile: false, root: fileURLToPath(new URL('./', import.meta.url)), publicDir: false,
    define: { __MAINNET_ARTIFACT__: JSON.stringify(artifact), __BUNDLE_PROOF__: JSON.stringify({ ...result, verifiedAt: new Date().toISOString() }) },
    build: { outDir: output, emptyOutDir: false } });
  return { output: actual, artifact };
}
async function start() {
  const output = await mkdtemp(path.join(tmpdir(), 'meshreceipt-mainnet-signing-'));
  await prepareBuild(output);
  const types = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.css': 'text/css; charset=utf-8' };
  const server = createServer(async (request, response) => {
    try {
      if (!['GET', 'HEAD'].includes(request.method)) { response.writeHead(405).end(); return; }
      const pathname = decodeURIComponent(new URL(request.url, 'http://127.0.0.1').pathname);
      const file = path.resolve(output, `.${pathname === '/' ? '/index.html' : pathname}`);
      if (!file.startsWith(`${output}${path.sep}`) || !(await stat(file)).isFile()) { response.writeHead(404).end(); return; }
      response.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream', 'Cache-Control': 'no-store', 'X-Content-Type-Options': 'nosniff',
        'Content-Security-Policy': "default-src 'none'; script-src 'self'; style-src 'unsafe-inline'; connect-src 'self' https://rpc.botchain.ai; img-src 'none'; base-uri 'none'; frame-ancestors 'none'; form-action 'none'" });
      response.end(request.method === 'HEAD' ? undefined : await readFile(file));
    } catch { response.writeHead(404).end(); }
  });
  server.listen(0, '127.0.0.1', () => console.log(JSON.stringify({ url: `http://127.0.0.1:${server.address().port}/`, buildDirectory: output,
    wallet: 'Chrome / OKX Wallet', scope: 'three transactions; pavilion PASS only', feeCapBOT: '0.05', transactionSent: false })));
}
if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  if (process.argv[2] === '--rebuild' && process.argv.length === 4) {
    await prepareBuild(process.argv[3]);
    console.log('Recovery build refreshed in the existing directory. No server restarted and no transaction sent.');
  } else { assertThat(process.argv.length === 2, 'Usage: node serve.js [--rebuild EXACT_EXISTING_TEMP_DIRECTORY]'); await start(); }
}

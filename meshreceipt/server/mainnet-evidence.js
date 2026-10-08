import { FetchRequest, JsonRpcProvider } from 'ethers';
import { Agent } from 'node:https';
import { verifyBundle, parseBundle, readBoundedFile, MAX_BUNDLE_BYTES } from '../src/bundle.js';
import { compareLocalDelivery, validateMainnetArchive, verifyMainnetOnProvider } from '../src/mainnet-proof.js';
import { FIXED, RPC } from '../experiments/bot-mainnet/protocol.js';
import { compileRegistry } from '../scripts/compile-contract.js';

export const EVIDENCE_DIRECTORY = new URL('../docs/evidence/', import.meta.url);
export const evidenceFile = name => new URL(name, EVIDENCE_DIRECTORY);
let checking = false;
export async function readPublishedEvidence() {
  const archive = validateMainnetArchive(JSON.parse(await readBoundedFile(evidenceFile('mainnet-original.json'), 32 * 1024)));
  const bundle = parseBundle(await readBoundedFile(evidenceFile('pavilion-qualified.json'), MAX_BUNDLE_BYTES));
  const { result } = await verifyBundle(bundle, { issuer: FIXED.provider, instance: FIXED.instance, providerId: FIXED.providerId });
  compareLocalDelivery(archive, bundle, result);
  const invocation = JSON.parse(await readBoundedFile(evidenceFile('agent-invocation.json'), 32 * 1024));
  if (invocation.taskId !== FIXED.taskId || invocation.agentRun?.schema !== 'meshreceipt.agent-run.v1'
    || invocation.agentRun.source !== 'responses-api' || !Array.isArray(invocation.agentRun.rounds)
    || ['inputHash', 'policyHash', 'outputHash', 'reportHash'].some(key => invocation[key] !== FIXED[key])) {
    throw new Error('历史 AI 调用记录与原交付不匹配');
  }
  return { archive, localVerification: result, localCheckedAt: new Date().toISOString(), status: 'archive-only', scope: 'single-pavilion-pass',
    invocation: { agentRun: invocation.agentRun, usage: invocation.usage,
      note: '2026-10-07 指定中转的实际网页任务；本页不重新调用模型，不独立核实底层模型身份或费用。' } };
}
export async function checkPublishedMainnet() {
  if (checking) throw new Error('主网只读核对正在运行，请稍后重试');
  checking = true;
  let provider, agent;
  try {
    const evidence = await readPublishedEvidence(), artifact = await compileRegistry();
    const request = new FetchRequest(RPC); request.timeout = 12_000;
    // A timed-out Node HTTPS request must not leave a pending socket alive.
    agent = new Agent({ keepAlive: false });
    request.getUrlFunc = FetchRequest.createGetUrlFunc({ agent });
    // Avoid the provider's unbounded auto-discovery retries. The verifier still
    // reads eth_chainId from this RPC, never trusting this transport setting.
    provider = new JsonRpcProvider(request, 677, { batchMaxCount: 1, staticNetwork: true });
    let timer;
    try {
      const chainVerification = await Promise.race([
        verifyMainnetOnProvider(evidence.archive, artifact, provider),
        new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('主网只读查询超时，归档不视为本次验证')), 20_000); }),
      ]);
      return { ...evidence, status: 'verified-now', chainVerification };
    } finally { clearTimeout(timer); }
  } finally { provider?.destroy(); agent?.destroy(); checking = false; }
}

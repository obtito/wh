import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { validateMainnetArchive, compareLocalDelivery } from '../src/mainnet-proof.js';
import { parseBundle, verifyBundle } from '../src/bundle.js';
import { FIXED } from '../experiments/bot-mainnet/protocol.js';

const original = process.argv[2];
if (!original) throw new Error('Usage: node scripts/archive-evidence.js /absolute/path/to/original-mainnet-evidence.json');
const directory = new URL('../docs/evidence/', import.meta.url);
const handoff = new URL(`../data/handoffs/${FIXED.taskId}/`, import.meta.url);
const entries = [
  ['mainnet-original.json', await readFile(original)],
  ['pavilion-qualified.json', await readFile(new URL(`bundles/meshreceipt-qualified-${FIXED.taskId}-${FIXED.attemptId}.json`, handoff))],
  ['pavilion-failure.json', await readFile(new URL(`bundles/meshreceipt-evidence-${FIXED.taskId}-66222e00-36f8-4b0f-8182-5fb3240fb717.json`, handoff))],
  ['agent-invocation.json', await readFile(new URL('agent-invocation.json', handoff))],
];
const archive = validateMainnetArchive(JSON.parse(entries[0][1]));
const qualified = parseBundle(entries[1][1]);
const { result } = await verifyBundle(qualified, { issuer: FIXED.provider, instance: FIXED.instance, providerId: FIXED.providerId });
compareLocalDelivery(archive, qualified, result);
const failure = parseBundle(entries[2][1]);
const failureTrust = { issuer: '0xf59e678daF69F9CB023083C2E96264ae6BFb111c', instance: FIXED.instance, providerId: 'rapid-demo' };
// This identity was recorded from the service catalog before the original export.
const trusted = JSON.parse(await readFile(new URL('teammate-check.json', handoff), 'utf8'));
if (trusted.failure?.issuer !== failureTrust.issuer || trusted.failure?.instance !== failureTrust.instance
  || trusted.failure?.provider !== failureTrust.providerId) throw new Error('独立记录的失败服务身份不匹配');
const failed = await verifyBundle(failure, failureTrust);
if (failed.result.verdict !== 'FAIL' || failed.result.qualified || failure.manifest.task.id !== FIXED.taskId
  || failure.manifest.attempt.id !== '66222e00-36f8-4b0f-8182-5fb3240fb717') throw new Error('失败取证身份或结论不匹配');
await mkdir(directory, { recursive: true });
const files = {};
for (const [name, bytes] of entries) {
  const target = new URL(name, directory);
  try { await writeFile(target, bytes, { flag: 'wx' }); }
  catch (error) { if (error.code !== 'EEXIST' || !(await readFile(target)).equals(bytes)) throw error; }
  files[name] = { bytes: bytes.length, sha256: createHash('sha256').update(bytes).digest('hex') };
}
await writeFile(new URL('archive-manifest.json', directory), `${JSON.stringify({ schema: 'meshreceipt.evidence-archive.v1', files,
  sourceCheckedAt: archive.checkedAt, qualifiedVerification: result, failureVerification: failed.result }, null, 2)}\n`, { flag: 'wx' });
console.log(JSON.stringify({ archived: Object.keys(files), chainReadPerformed: false, qualified: result.verdict, failure: failed.result.verdict }));

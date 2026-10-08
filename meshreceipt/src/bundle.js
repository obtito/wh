import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { verifyMessage, getAddress } from 'ethers';
import { canonicalJSON, hashJSON, sha256, LIMITS, validatePolicy, verifyDelivery } from './receipt.js';
import { readBoundedFile } from './file-reader.js';
export { readBoundedFile } from './file-reader.js';

export const BUNDLE_SCHEMA = 'meshreceipt.bundle.v2';
export const MAX_BUNDLE_BYTES = 32 * 1024 * 1024;
const LEGACY_FILES = Object.freeze(['original.glb', 'model.glb', 'policy.json', 'report.json', 'delivery.json']);
export const BUNDLE_FILES = Object.freeze([...LEGACY_FILES, 'README.txt']);
const FORMATS = new Map([
  ['meshreceipt.bundle.v1', { release: 'meshreceipt.release.v1', files: LEGACY_FILES }],
  [BUNDLE_SCHEMA, { release: 'meshreceipt.release.v2', files: BUNDLE_FILES }],
]);
const JSON_LIMIT = 512 * 1024;
const INSTRUCTIONS_LIMIT = 16 * 1024;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

function requireThat(condition, message) { if (!condition) throw new Error(message); }
function keys(value, names, label) {
  requireThat(value && typeof value === 'object' && !Array.isArray(value)
    && Object.keys(value).sort().join(',') === [...names].sort().join(','), `Invalid ${label} fields`);
}
function text(value, max = 256) { return typeof value === 'string' && value.length > 0 && value.length <= max; }
function hash(value) { return typeof value === 'string' && /^[0-9a-f]{64}$/.test(value); }
export function bundleSealMessage(instance, manifestHash, schema = BUNDLE_SCHEMA) {
  requireThat(FORMATS.has(schema), 'Unsupported bundle schema');
  return `${schema}:${instance}:${manifestHash}`;
}

export function validateSource(source, inputHash) {
  keys(source, ['assetId', 'title', 'creator', 'origin', 'license', 'authorization', 'inputHash'], 'source');
  requireThat(text(source.assetId, 80) && text(source.title) && text(source.creator) && text(source.origin, 500), 'Invalid source description');
  requireThat(source.authorization === 'project-owned-sample' && source.license === 'CC0-1.0'
    && source.inputHash === inputHash, 'Distribution authorization is missing or does not match the input');
  // This is the publisher's declaration, not a copyright/ownership proof.
  return source;
}

function usageInstructions(report) {
  return `MeshReceipt 离线交付包 v2 使用说明

准备工具
本包不含消费工具源码或运行依赖。请从可信渠道单独取得 MeshReceipt 源码与 package-lock.json，核对工具版本，不要执行陌生包提供的脚本。
需要 Node.js 22.9+。在可信工具目录运行 npm ci --ignore-scripts 安装锁定依赖；安装需要网络，下面的消费过程不访问发布者服务器或请求网络。
本次报告记录的验收器与依赖版本：${canonicalJSON(report.tools)}
版本不同导致复算不一致时应检查版本，不能忽略错误。

独立验证与提取
先从可信渠道确认签名者地址、应用实例 UUID 和服务标识。随包附带身份信息不是信任依据。
在可信工具目录运行以下命令，替换路径与全部 TRUSTED_* 占位符：
npm run consume -- /absolute/path/to/bundle.json --issuer TRUSTED_ADDRESS --instance TRUSTED_INSTANCE_UUID --provider TRUSTED_PROVIDER_ID --out /absolute/path/to/new-directory
输出目录必须不存在；省略 --out 时只验证。验证失败不提取，磁盘写入失败可能留下部分新目录，不能视为成功。
退出码：0=合格交付 PASS；1=已验证的 FAIL 取证；2=其他非合格取证；3=验证或文件操作错误。取证包即使 PASS 也不是合格发布。

模型与证据
成功提取后用支持 GLB 的查看器打开 model.glb。original.glb 是对照原模型；policy.json 是冻结规则；report.json 是检查项和工具版本；delivery.json 是服务交付签名。
manifest.json 与 seal.json 保存原发布清单及发布签名。verification.json 是本机复核结果，不是额外的签名证明。保留整个提取目录或原 JSON 包，不要只转交 model.glb。
提取目录可用清单的固定文件重建原封装并复核；当前 CLI 输入仍是 JSON 包，不接受目录。

许可与质量边界
本包只用于项目自有样例，CC0-1.0 是发布者的来源与分发声明，不是版权权属证明，也不给第三方地标自动授权。
PASS 只覆盖格式、大小、指定节点、层级、几何和动画等列出的规则，不保证材质、纹理、视觉保真、美观或所有渲染器兼容。
同一团队控制交付和清单签名者；签名不证明服务独立性或 BOT 主网存证。消费工具不是强恶意文件沙箱。
`;
}

export async function createBundle({ task, attempt, source, input, output, report, kind, signSeal }) {
  validateSource(source, task.inputHash);
  const bytes = {
    'original.glb': Buffer.from(input), 'model.glb': Buffer.from(output),
    'policy.json': Buffer.from(canonicalJSON(task.policy)), 'report.json': Buffer.from(canonicalJSON(report)),
    'delivery.json': Buffer.from(canonicalJSON(attempt.delivery)),
    'README.txt': Buffer.from(usageInstructions(report)),
  };
  const manifest = {
    schema: FORMATS.get(BUNDLE_SCHEMA).release, kind,
    task: { id: task.id, assetId: task.assetId, createdAt: task.createdAt, inputHash: task.inputHash, policyHash: task.policyHash, taskHash: task.taskHash },
    attempt: { id: attempt.id, providerId: attempt.providerId, outputHash: attempt.outputHash, reportHash: attempt.reportHash },
    source,
    files: Object.fromEntries(BUNDLE_FILES.map(name => [name, { bytes: bytes[name].length, sha256: sha256(bytes[name]) }])),
  };
  const manifestHash = hashJSON(manifest);
  return { schema: BUNDLE_SCHEMA, manifest, seal: await signSeal(manifestHash),
    files: Object.fromEntries(BUNDLE_FILES.map(name => [name, bytes[name].toString('base64')])) };
}

export function parseBundle(raw) {
  requireThat(Buffer.byteLength(raw) <= MAX_BUNDLE_BYTES, 'Bundle exceeds size limit');
  return JSON.parse(Buffer.isBuffer(raw) ? raw.toString('utf8') : raw);
}

/** Consumer has no dependency on the publisher's store, tasks, keys or HTTP server. */
export async function verifyBundle(bundle, trusted) {
  keys(bundle, ['schema', 'manifest', 'seal', 'files'], 'bundle');
  const format = FORMATS.get(bundle.schema);
  requireThat(format, 'Unsupported bundle schema');
  requireThat(trusted && text(trusted.issuer) && UUID.test(trusted.instance) && text(trusted.providerId, 80), 'Explicit trusted issuer, instance and provider are required');
  const issuer = getAddress(trusted.issuer);
  const { manifest, seal } = bundle;
  keys(manifest, ['schema', 'kind', 'task', 'attempt', 'source', 'files'], 'manifest');
  requireThat(manifest.schema === format.release && ['qualified', 'evidence'].includes(manifest.kind), 'Unsupported release kind/schema');
  keys(manifest.task, ['id', 'assetId', 'createdAt', 'inputHash', 'policyHash', 'taskHash'], 'task');
  keys(manifest.attempt, ['id', 'providerId', 'outputHash', 'reportHash'], 'attempt');
  const { task, attempt } = manifest;
  requireThat(UUID.test(task.id) && UUID.test(attempt.id) && text(task.assetId, 80) && text(task.createdAt, 64)
    && attempt.providerId === trusted.providerId, 'Invalid task/attempt context');
  requireThat([task.inputHash, task.policyHash, task.taskHash, attempt.outputHash, attempt.reportHash].every(hash), 'Invalid commitment hash');
  validateSource(manifest.source, task.inputHash);
  requireThat(manifest.source.assetId === task.assetId, 'Source asset mismatch');
  requireThat(hashJSON({ taskId: task.id, assetId: task.assetId, inputHash: task.inputHash, policyHash: task.policyHash, createdAt: task.createdAt }) === task.taskHash, 'Task commitment mismatch');
  keys(seal, ['scheme', 'issuer', 'instance', 'manifestHash', 'signature'], 'bundle seal');
  const manifestHash = hashJSON(manifest);
  requireThat(seal.scheme === `${bundle.schema}/EIP-191` && seal.instance === trusted.instance
    && getAddress(seal.issuer) === issuer && seal.manifestHash === manifestHash, 'Bundle seal/identity mismatch');
  requireThat(verifyMessage(bundleSealMessage(seal.instance, manifestHash, bundle.schema), seal.signature) === issuer, 'Invalid bundle signature');

  keys(bundle.files, format.files, 'bundle file list');
  keys(manifest.files, format.files, 'manifest file list');
  const files = {};
  for (const name of format.files) {
    const limit = name.endsWith('.glb') ? LIMITS.bytes : name === 'README.txt' ? INSTRUCTIONS_LIMIT : JSON_LIMIT;
    const entry = manifest.files[name], encoded = bundle.files[name];
    keys(entry, ['bytes', 'sha256'], 'file entry');
    requireThat(Number.isSafeInteger(entry.bytes) && entry.bytes > 0 && entry.bytes <= limit && hash(entry.sha256), 'Invalid bundled file bounds');
    requireThat(typeof encoded === 'string' && encoded.length === 4 * Math.ceil(entry.bytes / 3), 'Invalid base64 length');
    const bytes = Buffer.from(encoded, 'base64');
    requireThat(bytes.length === entry.bytes && bytes.toString('base64') === encoded && sha256(bytes) === entry.sha256, `File integrity mismatch: ${name}`);
    files[name] = bytes;
  }
  const readJSON = name => JSON.parse(files[name].toString('utf8'));
  const policy = validatePolicy(readJSON('policy.json')), report = readJSON('report.json'), delivery = readJSON('delivery.json');
  requireThat(sha256(files['original.glb']) === task.inputHash && sha256(files['model.glb']) === attempt.outputHash
    && hashJSON(policy) === task.policyHash, 'File/task commitment mismatch');
  keys(delivery, ['scheme', 'instance', 'issuer', 'payload', 'signature'], 'delivery signature');
  const expectedPayload = { taskHash: task.taskHash, taskId: task.id, attemptId: attempt.id, providerId: attempt.providerId,
    inputHash: task.inputHash, outputHash: attempt.outputHash, policyHash: task.policyHash };
  requireThat(delivery.scheme === 'meshreceipt.delivery.v1/EIP-191' && delivery.instance === trusted.instance
    && getAddress(delivery.issuer) === issuer && canonicalJSON(delivery.payload) === canonicalJSON(expectedPayload), 'Delivery context/identity mismatch');
  requireThat(verifyMessage(`meshreceipt.delivery.v1:${trusted.instance}:${hashJSON(expectedPayload)}`, delivery.signature) === issuer, 'Invalid delivery signature');
  requireThat(report && report.reportHash === attempt.reportHash, 'Report commitment mismatch');
  const { reportHash, ...core } = report;
  requireThat(hashJSON(core) === reportHash, 'Invalid report hash');
  const recomputed = await verifyDelivery(files['original.glb'], files['model.glb'], policy);
  requireThat(recomputed.reportHash === reportHash, 'Recomputation mismatch (check verifier/dependency versions)');
  requireThat(manifest.kind !== 'qualified' || recomputed.verdict === 'PASS', 'Only PASS can be a qualified release');
  return { files, result: { schema: bundle.schema, manifestHash, kind: manifest.kind, verdict: recomputed.verdict,
    integrity: true, signatureValid: true, recomputed: true, qualified: manifest.kind === 'qualified',
    issuer, instance: trusted.instance, providerId: trusted.providerId, reportHash, outputHash: attempt.outputHash,
    note: '来源许可为发布者声明；同一团队签署交付与包清单，不证明独立性、版权、视觉保真或主网存证。' } };
}

export async function consumeBundle(file, trusted, outputDirectory) {
  const bundle = parseBundle(await readBoundedFile(file, MAX_BUNDLE_BYTES));
  const verified = await verifyBundle(bundle, trusted);
  if (outputDirectory) {
    // Verification completes before creating anything. Never merge into an existing directory.
    await mkdir(outputDirectory, { mode: 0o700 });
    for (const [name, bytes] of Object.entries(verified.files)) await writeFile(path.join(outputDirectory, name), bytes, { flag: 'wx', mode: 0o600 });
    await writeFile(path.join(outputDirectory, 'manifest.json'), `${JSON.stringify(bundle.manifest, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await writeFile(path.join(outputDirectory, 'seal.json'), `${JSON.stringify(bundle.seal, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
    await writeFile(path.join(outputDirectory, 'verification.json'), `${JSON.stringify(verified.result, null, 2)}\n`, { flag: 'wx', mode: 0o600 });
  }
  return verified.result;
}

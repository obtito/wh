import { mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { liveConfigured } from '../server/agent.js';
import { createStore } from '../server/store.js';
import { ensureAssets } from '../server/assets.js';
import { createJobs } from '../server/jobs.js';

// Running this explicit command consents to sending only the project-owned sample's task metadata.
// Fresh temporary storage prevents sending the user's task history or changing their running server.
let directory;
try {
  if (!liveConfigured()) throw new Error('Configure OPENAI_API_KEY locally and use a supported OPENAI_REASONING_EFFORT before live verification');
  directory = await mkdtemp(path.join(os.tmpdir(), 'meshreceipt-live-smoke-'));
  const store = await createStore(directory), assets = await ensureAssets(path.join(directory, 'assets'));
  const jobs = await createJobs(store, assets);
  const created = await jobs.create({ assetId: 'pavilion', mode: 'model', instruction: '降低纹理体积，保留结构、几何和原有动画。', confirmModelData: true });
  await jobs.idle();
  const task = await store.get(created.id), successful = task.attempts.find(attempt => attempt.verdict === 'PASS');
  const verification = successful ? await jobs.reverify(task.id, successful.id) : null;
  const completed = task.status === 'PASSED' && verification?.integrity && verification?.signatureValid;
  process.stdout.write(`${JSON.stringify({ completed: Boolean(completed), mode: task.mode, status: task.status,
    taskHash: task.taskHash, inputHash: task.inputHash, policyHash: task.policyHash,
    attempts: task.attempts.map(attempt => ({ providerName: attempt.providerName, verdict: attempt.verdict, status: attempt.status, reportHash: attempt.reportHash })),
    agentRun: task.agentRun, verification, error: task.error ?? null,
    note: '仅本机联网执行记录，不是第三方证明；临时模型和身份将清理，不涉及主网交易。' }, null, 2)}\n`);
  process.exitCode = completed ? 0 : 1;
} catch (error) { console.error(JSON.stringify({ completed: false, error: error.message })); process.exitCode = 3; }
finally { if (directory) await rm(directory, { recursive: true, force: true }); }

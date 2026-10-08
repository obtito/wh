import { fork } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { hashJSON, sha256, validatePolicy, verifyDelivery } from '../src/receipt.js';
import { liveConfigured, runModelAgent } from './agent.js';

function worker(job, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    const child = fork(new URL('./worker.js', import.meta.url), [], { stdio: ['ignore', 'ignore', 'ignore', 'ipc'], execArgv: ['--max-old-space-size=256'] });
    let settled = false;
    const finish = (error, result) => {
      if (settled) return; settled = true; clearTimeout(timer);
      child.kill('SIGTERM'); error ? reject(error) : resolve(result);
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('Model worker timed out')); }, timeoutMs);
    child.on('error', error => finish(error));
    child.on('exit', code => { if (!settled) finish(new Error(`Worker exited before result (${code})`)); });
    child.on('message', message => message.ok ? finish(null, message.report) : finish(new Error(message.error)));
    child.send(job);
  });
}

export async function createJobs(store, assets, { timeoutMs = 30_000, env = process.env, fetcher = fetch } = {}) {
  let queued = 0, tail = Promise.resolve();
  for (const task of await store.list()) {
    if (['QUEUED', 'RUNNING'].includes(task.status)) {
      task.status = 'INTERRUPTED'; task.error = '服务重启打断了任务，请创建新任务。';
      for (const attempt of task.attempts) if (attempt.status === 'RUNNING') attempt.status = 'ERROR';
      await store.save(task);
    }
  }
  const publicRecords = async task => {
    const tasks = await store.list();
    return tasks.filter(item => item.id !== task.id && item.assetId === task.assetId && item.policyHash === task.policyHash)
      .flatMap(item => item.attempts.filter(a => a.status === 'COMPLETED').map(a => ({ taskId: item.id, attemptId: a.id,
        providerId: a.providerId, verdict: a.verdict, failedChecks: a.failedChecks, reportHash: a.reportHash })));
  };
  async function execute(task) {
    task.status = 'RUNNING'; await store.save(task);
    const log = async (kind, message) => { task.events.push({ id: randomUUID(), kind, message, at: new Date().toISOString() }); await store.save(task); };
    const query = async () => {
      const records = await publicRecords(task);
      task.historyUsed = records; await log('history', `读取到 ${records.length} 条同模型、同规则的历史记录；不构成整体信誉评分。`);
      return { providers: store.publicProviders(), records };
    };
    const run = async providerId => {
      const provider = store.providers.find(item => item.id === providerId);
      if (!provider || task.attempts.length >= 2 || task.attempts.some(item => item.providerId === providerId)
        || task.attempts.some(item => item.verdict === 'PASS')) throw new Error('Provider selection violates execution bounds');
      const attempt = { id: randomUUID(), providerId, providerName: provider.name, status: 'RUNNING', startedAt: new Date().toISOString(), verdict: null };
      task.attempts.push(attempt); await log('attempt', `调用 ${provider.name}，运行真实模型处理。`);
      const folder = path.join(store.taskPath(task.id), attempt.id); await mkdir(folder);
      try {
        const report = await worker({ inputPath: path.join(store.taskPath(task.id), 'original.glb'), outputPath: path.join(folder, 'model.glb'),
          reportPath: path.join(folder, 'report.json'), policy: task.policy, fault: provider.fault }, timeoutMs);
        if (report.inputHash !== task.inputHash || report.policyHash !== task.policyHash) throw new Error('Frozen task commitment mismatch');
        const payload = { taskHash: task.taskHash, taskId: task.id, attemptId: attempt.id, providerId,
          inputHash: report.inputHash, outputHash: report.outputHash, policyHash: report.policyHash };
        const delivery = await store.signDelivery(providerId, payload);
        Object.assign(attempt, { status: 'COMPLETED', verdict: report.verdict, reportHash: report.reportHash, outputHash: report.outputHash,
          outputBytes: report.delivery.bytes, checks: report.checks, failedChecks: report.checks.filter(c => !c.pass).map(c => c.id),
          delivery, completedAt: new Date().toISOString(), modelUrl: `/api/tasks/${task.id}/attempts/${attempt.id}/model`,
          reportUrl: `/api/tasks/${task.id}/attempts/${attempt.id}/report` });
        await log('verdict', `${provider.name}：${report.verdict}${attempt.failedChecks.length ? `，未满足 ${attempt.failedChecks.join(' / ')}` : ''}。`);
      } catch (error) {
        attempt.status = 'ERROR'; attempt.error = error.message;
        await log('error', `执行异常：${error.message}。不将运行异常计为服务质量失败。`);
      }
      await store.save(task);
      return { attemptId: attempt.id, providerId, status: attempt.status, verdict: attempt.verdict, failedChecks: attempt.failedChecks, error: attempt.error };
    };
    try {
      if (task.mode === 'model') await runModelAgent({ task, query, run, log, env, fetcher });
      else {
        const { records } = await query();
        const failed = new Set(records.filter(r => r.verdict === 'FAIL').map(r => r.providerId));
        const ordered = [...store.providers].sort((a, b) => Number(failed.has(a.id)) - Number(failed.has(b.id)) || a.costUnits - b.costUnits);
        await log('selection', failed.size ? '确定性演示：依据同类失败记录，先选未出现失败的服务。' : '确定性演示：无历史时先按模拟成本选择；故障适配器用于展示拒绝交付。');
        for (const provider of ordered) {
          const result = await run(provider.id); if (result.verdict === 'PASS') break;
        }
      }
      task.status = task.attempts.some(a => a.verdict === 'PASS') ? 'PASSED'
        : task.attempts.some(a => a.status === 'ERROR') ? 'ERROR' : 'NOT_ACCEPTED';
    } catch (error) { task.status = 'ERROR'; task.error = error.message; await log('error', error.message); }
    task.completedAt = new Date().toISOString(); await store.save(task);
  }
  return {
    async create(body) {
      if (!body || Object.keys(body).some(key => !['assetId', 'mode', 'instruction', 'confirmModelData'].includes(key))) throw new Error('Unknown task fields');
      if (queued >= 4) throw new Error('Task queue is full');
      const asset = assets.find(item => item.id === body.assetId && item.file);
      if (!asset) throw new Error('This asset is preview-only or unknown');
      if (!['demo', 'model'].includes(body.mode)) throw new Error('Choose demo or model mode');
      if (body.mode === 'model' && !liveConfigured(env)) throw new Error('Live model is not configured');
      if (body.mode === 'model' && body.confirmModelData !== true) throw new Error('Explicit model data disclosure confirmation is required');
      if (typeof body.instruction !== 'string' || body.instruction.length > 500) throw new Error('Invalid instruction');
      // Reserve synchronously: concurrent create calls must not bypass the cap.
      queued++;
      try {
      if ((await store.list()).length + queued > 100) throw new Error('Local demo task limit reached');
      const input = await readFile(asset.file); const policy = validatePolicy(asset.policy);
      const task = { id: randomUUID(), assetId: asset.id, assetTitle: asset.title, mode: body.mode, instruction: body.instruction,
        createdAt: new Date().toISOString(), status: 'QUEUED', policy, policyHash: hashJSON(policy), inputHash: sha256(input),
        attempts: [], events: [], historyUsed: [], distributionSource: asset.distributionSource ? structuredClone(asset.distributionSource) : null,
        ...(body.mode === 'model' ? { modelConsent: { confirmed: true, scope: 'title/instruction/policy/neutral-catalog/local-records' } } : {}) };
      task.taskHash = hashJSON({ taskId: task.id, assetId: task.assetId, inputHash: task.inputHash, policyHash: task.policyHash, createdAt: task.createdAt });
      await store.save(task); await writeFile(path.join(store.taskPath(task.id), 'original.glb'), input, { flag: 'wx' });
      tail = tail.then(() => execute(task)).catch(async error => { task.status = 'ERROR'; task.error = error.message; await store.save(task); })
        .finally(() => { queued--; });
      return task;
      } catch (error) { queued--; throw error; }
    },
    async idle() { await tail; },
    async reverify(taskId, attemptId) {
      const task = await store.get(taskId); const attempt = task.attempts.find(item => item.id === attemptId);
      if (!attempt || attempt.status !== 'COMPLETED') throw new Error('No completed attempt');
      const folder = path.join(store.taskPath(task.id), attempt.id);
      const [input, output, raw] = await Promise.all([readFile(path.join(store.taskPath(task.id), 'original.glb')), readFile(path.join(folder, 'model.glb')), readFile(path.join(folder, 'report.json'), 'utf8')]);
      const report = JSON.parse(raw), { reportHash, ...core } = report;
      const recomputed = await verifyDelivery(input, output, task.policy);
      const payload = attempt.delivery.payload;
      const integrity = reportHash === hashJSON(core) && reportHash === attempt.reportHash && recomputed.reportHash === reportHash
        && sha256(input) === task.inputHash && sha256(output) === attempt.outputHash && hashJSON(task.policy) === task.policyHash
        && payload.taskHash === task.taskHash && payload.taskId === task.id && payload.attemptId === attempt.id
        && payload.providerId === attempt.providerId && payload.inputHash === task.inputHash
        && payload.outputHash === attempt.outputHash && payload.policyHash === task.policyHash;
      const signatureValid = store.verifyDeliverySignature(attempt.delivery);
      return { integrity, signatureValid, verdict: recomputed.verdict, reportHash: recomputed.reportHash,
        note: '签名来自团队控制的演示服务；有效签名不等于独立质量证明。' };
    },
  };
}

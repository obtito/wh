// Local release QA only. Not a product dependency and never uses the author's .env.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { createHash } from 'node:crypto';
import http from 'node:http';

const candidate = path.resolve(process.argv[2] || '');
if (!process.argv[2]) throw new Error('Usage: node scripts/release-smoke.js RELEASE_DIRECTORY [--record]');
const record = process.argv[3] === '--record';
const { chromium } = await import('/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const { createApp } = await import(pathToFileURL(path.join(candidate, 'server/index.js')));
const { consumeBundle } = await import(pathToFileURL(path.join(candidate, 'src/bundle.js')));
const parent = fileURLToPath(new URL('../data/release-qa/', import.meta.url));
await mkdir(parent, { recursive: true, mode: 0o700 });
const output = await mkdtemp(path.join(parent, 'run-'));
const env = { MESHRECEIPT_CORE_ONLY: '1', PORT: '0' };
const app = await createApp({ directory: path.join(output, 'private-store'), workspace: path.join(output, 'no-neighbors'),
  staticDirectory: path.join(candidate, 'dist'), env });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve));
env.PORT = String(app.server.address().port);
const base = `http://127.0.0.1:${env.PORT}`;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  headless: true, args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await context.newPage();
const errors = [], results = { schema: 'meshreceipt.release-browser-qa.v1', checkedAt: new Date().toISOString(),
  candidate, fingerprint: JSON.parse(await readFile(path.join(candidate, 'RELEASE.json'))).fingerprint,
  browser: await browser.version(), base, externalComputerConfirmed: false, modelAPICalls: 0, blockchainTransactions: 0 };
let recipientServer;
page.on('pageerror', error => errors.push(error.message));
const chapter = async (title, description) => {
  if (record) await page.screencast.showChapter(title, { description, duration: 3000 });
};
const pause = async () => { if (record) await page.waitForTimeout(4000); };
const screenshot = name => page.screenshot({ path: path.join(output, name), fullPage: false });
try {
  if (record) await page.screencast.start({ path: path.join(output, 'meshreceipt-core-demo.webm'), size: { width: 1440, height: 1000 } });
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('heading', { name: '流光亭交付与主网凭据' }).waitFor();
  assert.equal(await page.locator('.asset-card').count(), 3);
  const config = await (await fetch(`${base}/api/config`)).json();
  assert.equal(config.coreOnly, true); assert.equal(config.modelAvailable, false);
  const providers = await (await fetch(`${base}/api/providers`)).json();
  // Identities come from the configured local service catalog BEFORE export,
  // never from an untrusted package's self-declared seal.
  await chapter('琢信 · 模型与履约依据一起交付', '本次实际操作：本机隔离交付版；确定性编排不是实时 AI。');
  await screenshot('01-home.png'); await pause();
  await page.getByRole('button', { name: /处理并交付模型/ }).click();
  await page.waitForFunction(() => document.querySelector('model-viewer')?.loaded === true);
  results.originalModelLoaded = true;
  await screenshot('02-original-model.png');
  await chapter('事前固定规则，执行真实处理', '格式、大小、节点、层级、几何与动画；不保证材质、纹理视觉质量。');
  await page.getByRole('button', { name: '创建并运行验收 →' }).scrollIntoViewIfNeeded(); await pause();
  await page.getByRole('button', { name: '创建并运行验收 →' }).click();
  await page.locator('.task-panel > .section-heading .badge.pass').waitFor({ timeout: 30_000 });
  const tasks = await (await fetch(`${base}/api/tasks`)).json(), task = tasks[0];
  assert.deepEqual(task.attempts.map(attempt => attempt.verdict), ['FAIL', 'PASS']);
  results.firstTask = { id: task.id, verdicts: task.attempts.map(attempt => attempt.verdict), historyUsed: task.historyUsed.length };
  await chapter('故障交付拒收，再换服务', '团队受控故障样例删去动画而 FAIL；第二次在限定规则下 PASS。');
  await page.locator('.attempt').first().scrollIntoViewIfNeeded(); await screenshot('03-failure-and-pass.png'); await pause();
  const passed = task.attempts.find(attempt => attempt.verdict === 'PASS'), passPanel = page.locator('.attempt').last();
  await passPanel.getByRole('checkbox').check();
  await passPanel.getByRole('button', { name: '导出限定规则合格包 ↓' }).scrollIntoViewIfNeeded();
  await chapter('真实导出，不只是绿色标签', '原模型、交付 GLB、固定规则、报告、签名、来源与说明一并封装。');
  const [download] = await Promise.all([page.waitForEvent('download'), passPanel.getByRole('button', { name: '导出限定规则合格包 ↓' }).click()]);
  const packageFile = path.join(output, download.suggestedFilename()); await download.saveAs(packageFile);
  await screenshot('04-export.png'); await pause();
  const known = providers.find(provider => provider.id === passed.providerId);
  assert.ok(known && known.issuer === passed.delivery.issuer);
  const trust = { issuer: known.issuer, instance: passed.delivery.instance, providerId: known.id };
  const recipient = path.join(output, 'recipient');
  const verified = await consumeBundle(packageFile, trust, recipient);
  assert.equal(verified.qualified, true);
  const glb = await readFile(path.join(recipient, 'model.glb'));
  results.consumption = { qualified: verified.qualified, verdict: verified.verdict,
    outputHash: verified.outputHash, bytes: glb.length, trustSource: 'configured localhost service catalog and completed task before reading exported package' };
  const altered = JSON.parse(await readFile(packageFile, 'utf8'));
  const changed = Buffer.from(altered.files['model.glb'], 'base64'); changed[changed.length - 1] ^= 1;
  altered.files['model.glb'] = changed.toString('base64');
  const tampered = path.join(output, 'tampered.json'); await writeFile(tampered, JSON.stringify(altered), { flag: 'wx' });
  await assert.rejects(consumeBundle(tampered, trust), /integrity/); results.tamperRejected = true;
  const viewerFiles = (await readdir(path.join(candidate, 'dist/assets'))).filter(name => name.endsWith('.js'));
  const viewer = viewerFiles.find(name => /^model-viewer.*\.js$/.test(name));
  const recipientHtml = `<!doctype html><html lang="zh-CN"><meta charset="utf-8"><style>body{margin:0;background:#eeeee3;color:#23473c;font:16px sans-serif;padding:36px}h1{font:34px serif}model-viewer{display:block;width:100%;height:660px;background:#dde4d8;border-radius:20px}p{line-height:1.8}</style><h1>接收端 · 模型与依据独立复算</h1><p>本机隔离消费，不冒充另一台电脑或队友操作。已从导出包提取 model.glb；材质、纹理视觉质量未验收。</p><model-viewer src="/model.glb" alt="独立消费提取的流光亭" camera-controls auto-rotate autoplay shadow-intensity="1" environment-image="neutral"></model-viewer><p id="result"></p><script type="module" src="/assets/${viewer}"></script></html>`;
  // A separate receiver has no routes to the publisher's database or original
  // GLB: it serves only the consumed model and compiled viewing runtime.
  recipientServer = http.createServer(async (request, response) => {
    try {
      const url = new URL(request.url, 'http://127.0.0.1');
      if (url.pathname === '/') { response.writeHead(200, { 'content-type': 'text/html; charset=utf-8' }); response.end(recipientHtml); return; }
      if (url.pathname === '/model.glb') { response.writeHead(200, { 'content-type': 'model/gltf-binary' }); response.end(glb); return; }
      const name = url.pathname.replace(/^\/assets\//, '');
      if (url.pathname.startsWith('/assets/') && viewerFiles.includes(name)) {
        response.writeHead(200, { 'content-type': 'text/javascript; charset=utf-8' });
        response.end(await readFile(path.join(candidate, 'dist/assets', name))); return;
      }
      response.writeHead(404); response.end();
    } catch { response.writeHead(500); response.end(); }
  });
  await new Promise(resolve => recipientServer.listen(0, '127.0.0.1', resolve));
  await page.goto(`http://127.0.0.1:${recipientServer.address().port}`, { waitUntil: 'networkidle' });
  await page.waitForFunction(() => document.querySelector('model-viewer')?.loaded === true);
  results.consumerModelLoaded = true;
  await page.locator('#result').evaluate((element, hash) => { element.textContent = `限定规则 PASS · 修改一个字节后已拒绝 · SHA-256 ${hash}`; }, createHash('sha256').update(glb).digest('hex'));
  await chapter('离开发布者数据库，仍能复核', '验签、重新运行规则、提取模型并实际载入；篡改一个字节会被拒绝。');
  await screenshot('05-consumer-model.png'); await pause();
  await page.goto(base, { waitUntil: 'networkidle' });
  const evidence = page.locator('#delivery-evidence');
  await evidence.scrollIntoViewIfNeeded();
  await evidence.locator('summary').click();
  await chapter('历史真实 AI 与已有主网记录', '原任务 3 轮 API 工具调用与 3 笔 BOT 主网历史凭据；仅一份 PASS，FAIL 留在链下。');
  await screenshot('06-historical-evidence.png'); await pause();
  await evidence.getByRole('button', { name: '重新核对这份交付（不发交易）' }).click();
  await page.waitForFunction(() => !document.querySelector('#delivery-evidence button')?.disabled, null, { timeout: 30_000 });
  results.chainRead = await evidence.locator('.badge').innerText();
  results.chainReadError = await evidence.locator('[role=alert]').count() ? await evidence.locator('[role=alert]').innerText() : null;
  await screenshot('07-mainnet-read.png');
  await chapter('后续用户可以复用可核查记录', '当前仅本机历史复用；全球信誉、跨主体选择和全面视觉验收尚未实现。');
  await page.getByRole('button', { name: /处理并交付模型/ }).click();
  const [createdResponse] = await Promise.all([
    page.waitForResponse(response => response.url() === `${base}/api/tasks` && response.request().method() === 'POST'),
    page.getByRole('button', { name: '创建并运行验收 →' }).click(),
  ]);
  const nextId = (await createdResponse.json()).id;
  await page.locator('.commitments code').filter({ hasText: nextId.slice(0, 10) }).waitFor();
  await page.locator('.task-panel > .section-heading .badge.pass').waitFor({ timeout: 30_000 });
  const next = (await (await fetch(`${base}/api/tasks`)).json()).find(item => item.id === nextId);
  assert.equal(next.attempts.length, 1); assert.ok(next.historyUsed.length > 0);
  results.historyReuse = { attempts: next.attempts.length, historyUsed: next.historyUsed.length, verdict: next.attempts[0].verdict };
  await page.locator('.task-panel').scrollIntoViewIfNeeded(); await screenshot('08-history-reuse.png'); await pause();
  const mobile = await context.newPage({ viewport: { width: 390, height: 844 } });
  await mobile.setViewportSize({ width: 390, height: 844 });
  await mobile.goto(base, { waitUntil: 'networkidle' });
  await mobile.getByRole('heading', { name: '流光亭交付与主网凭据' }).waitFor();
  const width = await mobile.evaluate(() => ({ content: document.documentElement.scrollWidth, viewport: innerWidth }));
  assert.ok(width.content <= width.viewport + 1, `Mobile horizontal overflow: ${JSON.stringify(width)}`);
  await mobile.screenshot({ path: path.join(output, '09-mobile-home.png') });
  await mobile.getByRole('button', { name: /处理并交付模型/ }).click();
  await mobile.getByRole('button', { name: '创建并运行验收 →' }).scrollIntoViewIfNeeded();
  assert.ok(await mobile.getByRole('button', { name: '创建并运行验收 →' }).isVisible());
  await mobile.screenshot({ path: path.join(output, '10-mobile-controls.png') }); await mobile.close();
  assert.deepEqual(errors, []); results.pageErrors = errors; results.mobileNoOverflow = true;
  results.status = 'passed';
} catch (error) {
  results.status = 'failed'; results.error = error.message; results.pageErrors = errors;
  await screenshot('failure.png').catch(() => {}); process.exitCode = 1;
} finally {
  if (record) await page.screencast.stop().catch(() => {});
  await context.close(); await browser.close(); await app.jobs.idle();
  if (recipientServer) { recipientServer.closeAllConnections(); await new Promise(resolve => recipientServer.close(resolve)); }
  app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve));
  await writeFile(path.join(output, 'browser-result.json'), `${JSON.stringify(results, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output, ...results }, null, 2));
}

// Records real existing UI. No product writes, model uploads, live AI or chain calls.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile, stat } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const project = fileURLToPath(new URL('../', import.meta.url));
const base = process.argv[2] || 'http://127.0.0.1:64081';
const origin = new URL(base);
if (origin.hostname !== '127.0.0.1' || origin.protocol !== 'http:' || origin.pathname !== '/') throw new Error('Use an explicit loopback preview origin');
const { chromium } = await import('/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const parent = path.join(project, 'data/city-videos'); await mkdir(parent, { recursive: true });
const output = await mkdtemp(path.join(parent, 'take-'));
const video = path.join(output, 'meshreceipt-city-demo.webm');
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1600, height: 1000 }, deviceScaleFactor: 1, acceptDownloads: true });
const page = await context.newPage(), errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message));
page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
const chapters = [];
const result = { recordedAt: new Date().toISOString(), base, browser: await browser.version(), viewport: '1600x1000',
  audio: false, content: 'Existing city-base functionality only; candidate placement and submission are not yet implemented',
  liveModelCalls: 0, blockchainTransactions: 0, uploadedModels: 0, chapters };
let recording = false, recordedAt;
async function chapter(title, description) {
  chapters.push({ seconds: Math.round((Date.now() - recordedAt) / 100) / 10, title, description });
  console.log(`Recording: ${title}`);
  await page.screencast.showChapter(title, { description, duration: 2500 });
}
const pause = () => page.waitForTimeout(3500);
async function click(selector) {
  const element = page.locator(selector); await element.scrollIntoViewIfNeeded();
  const box = await element.boundingBox(); await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2, { steps: 15 });
  await page.waitForTimeout(300); await element.click(); await page.waitForTimeout(800);
}
try {
  const response = await page.goto(`${base}/city/index.html`, { waitUntil: 'networkidle' }); assert.equal(response.status(), 200);
  await page.waitForFunction(() => document.querySelector('#viewport canvas')?.dataset.ready === 'true'
    && Number(document.querySelector('#viewport canvas').dataset.renders) > 0, null, { timeout: 30_000 });
  assert.equal(await page.locator('#point-list button').count(), 8);
  assert.equal(await page.locator('#error').isVisible(), false);
  assert.equal(await page.getByRole('button', { name: '社区提交 · 尚未开放' }).isEnabled(), false);
  // The displayed build must match the current page sources, not a stale prototype.
  for (const name of ['index.html', 'main.js', 'plan.js', 'style.css', 'snapshot-check.js']) {
    const served = new Uint8Array(await (await context.request.get(`${base}/city/${name}`)).body());
    assert.deepEqual(Buffer.from(served), await readFile(path.join(project, 'public/city', name)));
  }
  result.baseVersion = await page.locator('#viewport canvas').getAttribute('data-base-version');
  await page.screenshot({ path: path.join(output, '01-overview.png') });
  await page.screencast.start({ path: video, size: { width: 1600, height: 1000 } }); recording = true; recordedAt = Date.now();
  await chapter('琢信 · 江城共琢', '真实页面操作：道路、水系、山体与 8 处待建点位。建筑暂留白，不是已完成的数字城市。'); await pause();
  await chapter('先铺底图，再组织模型贡献', '采用指定的本地 GTA-WH 快照。拖动旋转查看两江三镇；底图与坐标均为参考级。');
  const map = await page.locator('#viewport').boundingBox();
  await page.mouse.move(map.x + map.width * .55, map.y + map.height * .55);
  await page.mouse.down(); await page.mouse.move(map.x + map.width * .69, map.y + map.height * .55, { steps: 45 }); await page.mouse.up(); await pause();
  await click('#overview');
  await chapter('选择黄鹤楼，查看建模上下文', '点位 ID、参考经纬度和底图版本可追溯。标记圆只是交互提示，不是核定的建筑占地。');
  await click('#point-list button[data-point-id="wuhan:huanghelou"]');
  assert.equal(await page.locator('#point-name').innerText(), '黄鹤楼');
  await page.screenshot({ path: path.join(output, '02-huanghelou.png') }); await pause();
  await chapter('查找另一处待建点位', '搜索江汉关并聚焦。社区采纳版本仍为 0，现有地标模型未自动计为贡献。');
  await page.locator('#search').fill('江汉关'); await page.waitForTimeout(700); await click('#point-list button');
  assert.equal(await page.locator('#point-name').innerText(), '江汉关大楼'); await pause();
  await page.locator('#search').fill(''); await click('#overview');
  await chapter('区分原始路网与场景调整路网', '两种路网都可查看。游戏化调整不能冒充实测数据；地形也不是卫星高程复原。');
  await page.locator('#road-mode').selectOption('original'); await page.waitForTimeout(2000); await click('#top'); await pause();
  await page.locator('#road-mode').selectOption('scene'); await click('#overview');
  await chapter('按需查看道路与山体', '实际切换图层，检查城市空间骨架。道路、水系和点位分开表达。');
  await page.locator('#roads-toggle').uncheck(); await page.waitForTimeout(1300); await page.locator('#terrain-toggle').uncheck(); await pause();
  await page.locator('#roads-toggle').check(); await page.locator('#terrain-toggle').check();
  await chapter('真实下载点位需求草案', '草案绑定点位和底图版本；占地与朝向仍待复核。它不是验收通过、版权授权或链上凭证。');
  await click('#point-list button[data-point-id="wuhan:huanghelou"]');
  const pendingDownload = page.waitForEvent('download'); await click('#download'); const download = await pendingDownload;
  const draftFile = path.join(output, 'huanghelou-request-draft.json'); await download.saveAs(draftFile);
  const draft = JSON.parse(await readFile(draftFile));
  assert.equal(draft.pointId, 'wuhan:huanghelou'); assert.equal(draft.baseVersion, result.baseVersion);
  assert.equal(draft.onChain, false); assert.equal(draft.submissionEnabled, false); assert.equal(draft.footprint, null);
  result.downloadVerified = { pointId: draft.pointId, baseVersion: draft.baseVersion, draftOnly: true }; await pause();
  await click('#overview');
  await chapter('下一步：模型落位与候选草稿', '尚未实现：GLB 导入、落位参数保存、社区审核和链上贡献登记。此次录像没有上传模型或发送交易。');
  await pause(); await page.screenshot({ path: path.join(output, '03-ending.png') });
  assert.deepEqual(errors, []);
  assert.ok(requests.every(request => request.method === 'GET' && request.url.startsWith(base)));
  assert.ok(!requests.some(request => /\.(glb|gltf|blend)(\?|$)/.test(request.url)));
  result.status = 'passed'; result.pageErrors = errors; result.onlyLocalReadRequests = true;
} catch (error) {
  result.status = 'failed'; result.error = error.message; result.pageErrors = errors; process.exitCode = 1;
  await page.screenshot({ path: path.join(output, 'failure.png') }).catch(() => {});
} finally {
  if (recording) await page.screencast.stop();
  await context.close(); await browser.close();
  if (recording) {
    const bytes = await readFile(video); result.video = { file: video, bytes: (await stat(video)).size,
      sha256: createHash('sha256').update(bytes).digest('hex') };
  }
  await writeFile(path.join(output, 'recording-result.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output, ...result }, null, 2));
}

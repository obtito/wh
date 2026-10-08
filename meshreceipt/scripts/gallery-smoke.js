// Private, local gallery regression. Third-party assets are not put in the core release.
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { build } from 'vite';
import { createApp } from '../server/index.js';

const { chromium } = await import('/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const project = fileURLToPath(new URL('../', import.meta.url));
const parent = path.join(project, 'data', 'gallery-qa'); await mkdir(parent, { recursive: true, mode: 0o700 });
const output = await mkdtemp(path.join(parent, 'run-'));
const staticDirectory = path.join(output, 'frontend');
await build({ root: project, build: { outDir: staticDirectory, emptyOutDir: true } });
const env = { PORT: '0' }, app = await createApp({ directory: path.join(output, 'private-store'), staticDirectory, env });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); env.PORT = String(app.server.address().port);
const base = `http://127.0.0.1:${env.PORT}`;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const results = { checkedAt: new Date().toISOString(), browser: await browser.version(), base, checks: {},
  thirdPartyDistribution: false, modelAPICalls: 0, transactions: 0 }, errors = [];
page.on('pageerror', error => errors.push(error.message));
async function open(title) {
  results.activeAsset = title;
  await page.locator('.asset-card').getByRole('button', { name: `查看${title}`, exact: true }).click();
  const handle = await page.locator('.source-preview:not([hidden])').elementHandle();
  const frame = await handle.contentFrame();
  await frame.waitForFunction(() => document.querySelector('canvas') && document.querySelector('#controls button, .toolbar button')?.disabled === false,
    null, { timeout: 60_000 });
  await page.locator('.preview-cache .preview-loading').waitFor({ state: 'hidden', timeout: 15_000 });
  return frame;
}
async function shot(name) { await page.screenshot({ path: path.join(output, `${name}.png`) }); }
async function close() { await page.getByRole('button', { name: '关闭资产详情' }).click(); }
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('button', { name: '查看黄鹤楼', exact: true }).waitFor();
  const yellow = await open('黄鹤楼');
  assert.equal(await yellow.locator('#parts button[aria-pressed=true]').getAttribute('data-id'), 'glb-latest');
  const versions = [];
  for (const id of ['glb-latest', 'blender-refined', 'glb-original', 'code-stage3']) {
    await yellow.locator(`#parts button[data-id="${id}"]`).click();
    await yellow.waitForFunction(expected => document.querySelector('#parts button[aria-pressed=true]')?.dataset.id === expected
      && document.querySelector('#viewport')?.getAttribute('aria-busy') === 'false', id, { timeout: 60_000 });
    assert.equal(await yellow.locator('#error').innerText(), '');
    await shot(`huanghe-${id}`); versions.push(id);
  }
  await yellow.getByRole('button', { name: '正视', exact: true }).click(); await close();
  const warm = await open('黄鹤楼');
  assert.equal(warm, yellow); assert.equal(await warm.locator('#front').getAttribute('aria-pressed'), 'true');
  assert.equal(await warm.locator('#parts button[aria-pressed=true]').getAttribute('data-id'), 'code-stage3');
  results.checks.huanghe = { default: 'glb-latest', versions, warmReopenRetainsCamera: true }; await close();
  const zifeng = await open('紫峰大厦');
  await zifeng.getByRole('button', { name: '夜景', exact: true }).click();
  assert.equal(await zifeng.getByRole('button', { name: '夜景', exact: true }).getAttribute('aria-pressed'), 'true');
  await shot('zifeng-night'); await zifeng.getByRole('button', { name: '白天', exact: true }).click(); await shot('zifeng-day');
  results.checks.zifeng = { dayAndNight: true, desktopFrame: true }; await close();
  const wuhan = await open('武汉地标建筑');
  await wuhan.waitForFunction(() => document.querySelector('#status')?.textContent.includes('5/5 模型已载入'), null, { timeout: 60_000 });
  const buildings = [];
  for (const id of ['greenland', 'wuhan-center', 'ctf-finance', 'shipping-center', 'panhai-times']) {
    await wuhan.locator(`#parts button[data-id="${id}"]`).click();
    assert.equal(await wuhan.locator('#parts button[aria-pressed=true]').getAttribute('data-id'), id);
    assert.match(await wuhan.locator('#status').innerText(), /单体模型已载入/); buildings.push(id);
  }
  await wuhan.locator('#parts button[data-id=all]').click(); await shot('wuhan-five-towers');
  assert.equal(await wuhan.locator('#error').innerText(), ''); results.checks.wuhan = { buildings, complete: true }; await close();
  const heritage = await open('中山陵 · 全轴线');
  assert.equal(await heritage.locator('#error').innerText(), ''); await shot('zhongshanling-cover');
  results.checks.zhongshanling = { loaded: true, unaccepted: true }; await close();
  assert.ok(await page.locator('.source-preview').count() <= 2);
  results.previewCacheLimit = true;
  await page.setViewportSize({ width: 390, height: 844 });
  const mobile = await open('紫峰大厦');
  await mobile.getByRole('button', { name: '夜景', exact: true }).click();
  assert.equal(await mobile.locator('#error').innerText(), ''); await shot('zifeng-mobile');
  results.checks.zifeng.mobileFrame = true;
  assert.deepEqual(errors, []); results.pageErrors = errors; results.status = 'passed';
} catch (error) {
  results.status = 'failed'; results.error = error.message; results.pageErrors = errors;
  await shot('failure').catch(() => {}); process.exitCode = 1;
} finally {
  await browser.close(); await app.jobs.idle(); app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve));
  await writeFile(path.join(output, 'gallery-result.json'), `${JSON.stringify(results, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output, ...results }, null, 2));
}

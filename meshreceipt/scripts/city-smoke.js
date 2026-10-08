// Local browser verification only; never submits models, calls a live model or sends transactions.
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { createApp } from '../server/index.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const { chromium } = await import('/Users/Admin/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/node_modules/playwright/index.mjs');
const parent = path.join(project, 'data/city-qa'); await mkdir(parent, { recursive: true });
const output = await mkdtemp(path.join(parent, 'run-')), staticDirectory = path.join(output, 'frontend');
await build({ root: project, build: { outDir: staticDirectory, emptyOutDir: true } });
const env = { PORT: '0' }, app = await createApp({ directory: path.join(output, 'private-store'), staticDirectory, env });
await new Promise(resolve => app.server.listen(0, '127.0.0.1', resolve)); env.PORT = String(app.server.address().port);
const base = `http://127.0.0.1:${env.PORT}`;
const browser = await chromium.launch({ executablePath: '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome', headless: true,
  args: ['--use-angle=swiftshader', '--enable-unsafe-swiftshader'] });
const context = await browser.newContext({ viewport: { width: 1440, height: 1000 }, reducedMotion: 'reduce' });
const page = await context.newPage(), errors = [], requests = [];
page.on('pageerror', error => errors.push(error.message)); page.on('request', request => requests.push({ url: request.url(), method: request.method() }));
const result = { checkedAt: new Date().toISOString(), base, browser: await browser.version(), source: '/Users/Admin/Desktop/gta-wh', checks: {},
  liveModelCalls: 0, transactions: 0, uploadedModels: 0 };
async function ready(target = page) {
  await target.waitForFunction(() => document.querySelector('#viewport canvas')?.dataset.ready === 'true'
    && Number(document.querySelector('#viewport canvas').dataset.renders) > 0, null, { timeout: 30_000 });
}
async function diagnostics() { return page.locator('#viewport canvas').evaluate(canvas => ({ ...canvas.dataset })); }
async function screenshot(name) { await page.screenshot({ path: path.join(output, `${name}.png`), fullPage: true }); }
try {
  await page.goto(base, { waitUntil: 'networkidle' });
  await page.getByRole('link', { name: '城市共建 ↗' }).click(); await ready();
  assert.equal(await page.locator('#point-list button').count(), 8); assert.equal(await page.locator('#point-count').innerText(), '8');
  assert.equal(await page.locator('#error').isVisible(), false); assert.equal(await page.getByRole('button', { name: '社区提交 · 尚未开放' }).isEnabled(), false);
  result.checks.desktop = await diagnostics(); await screenshot('01-city-overview');
  const boxes = await page.locator('.map-label:visible').evaluateAll(nodes => nodes.map(node => {
    const { left, right, top, bottom } = node.getBoundingClientRect(); return { left, right, top, bottom };
  }));
  assert.ok(boxes.length >= 7);
  for (let i = 0; i < boxes.length; i++) for (let j = i + 1; j < boxes.length; j++) {
    const a = boxes[i], b = boxes[j]; assert.ok(!(a.left < b.right && a.right > b.left && a.top < b.bottom && a.bottom > b.top));
  }
  result.checks.visibleLabelsDoNotOverlap = true;
  await page.locator('#search').fill('江汉关'); assert.equal(await page.locator('#point-list button').count(), 1);
  await page.locator('#point-list button').click(); assert.equal(await page.locator('#point-name').innerText(), '江汉关大楼');
  await screenshot('02-selected-point');
  const downloadPromise = page.waitForEvent('download'); await page.locator('#download').click();
  const download = await downloadPromise; await download.saveAs(path.join(output, 'point-request-draft.json'));
  const draft = JSON.parse(await readFile(path.join(output, 'point-request-draft.json')));
  assert.equal(draft.pointId, 'wuhan:jianghanguan'); assert.equal(draft.submissionEnabled, false); assert.equal(draft.onChain, false);
  assert.equal(draft.footprint, null); assert.equal(draft.baseVersion, result.checks.desktop.baseVersion);
  result.checks.pointSelectionAndDraft = { pointId: draft.pointId, draftOnly: true };
  await page.locator('#search').fill('找不到的点位'); assert.equal(await page.locator('#point-list button').count(), 0);
  assert.equal(await page.locator('#no-points').isVisible(), true); await page.locator('#search').fill('');
  await page.locator('#top').click(); assert.equal(await page.locator('#top').getAttribute('aria-pressed'), 'true');
  await page.locator('#overview').click(); assert.equal(await page.locator('#top').getAttribute('aria-pressed'), 'false');
  const memory = [];
  for (let i = 0; i < 6; i++) {
    const mode = i % 2 ? 'scene' : 'original'; await page.locator('#road-mode').selectOption(mode);
    await page.waitForFunction(expected => document.querySelector('#viewport canvas').dataset.roadMode === expected, mode);
    memory.push(await diagnostics());
  }
  const baseline = Number(memory[1].geometries); assert.ok(memory.every(item => Number(item.geometries) <= baseline + 1));
  await page.locator('#roads-toggle').uncheck(); await page.locator('#terrain-toggle').uncheck();
  await screenshot('03-layers-off'); await page.locator('#roads-toggle').check(); await page.locator('#terrain-toggle').check();
  result.checks.layersAndRoadModes = { switches: 6, rendererMemory: memory, geometryCountDidNotTrendUp: true };
  await page.waitForTimeout(300); const before = Number((await diagnostics()).renders); await page.waitForTimeout(500);
  const after = Number((await diagnostics()).renders); assert.equal(after, before);
  result.checks.onDemandRendering = { rendersBeforeIdle: before, rendersAfterIdle: after, idleIntervalMs: 500 };
  await page.locator('#sources').click();
  assert.match(await page.locator('#source-info').innerText(), /\/Users\/Admin\/Desktop\/gta-wh/);
  assert.match(await page.locator('#source-info').innerText(), /"dirty": true/); await page.locator('#close-sources').click();
  await page.setViewportSize({ width: 390, height: 844 }); await page.locator('#overview').click(); await ready();
  assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), true);
  await screenshot('04-city-mobile'); result.checks.mobile = { viewport: '390x844', noHorizontalOverflow: true };
  const isolated = await context.newPage(); await isolated.goto(`${base}/city/index.html`); await ready(isolated);
  assert.equal(await isolated.locator('#point-list button').count(), 8); await isolated.close();
  result.checks.standaloneEntry = true;
  const tampered = await context.newPage();
  await tampered.route('**/city/snapshot/data/osm/roads.json', route => route.fulfill({ contentType: 'application/json', body: '[]' }));
  await tampered.goto(`${base}/city/index.html`);
  await tampered.locator('#error').waitFor({ state: 'visible' });
  assert.match(await tampered.locator('#error').innerText(), /指纹不一致/);
  assert.equal(await tampered.locator('#viewport canvas').count(), 0); await tampered.close(); result.checks.tamperedSnapshotRejected = true;
  const coreEnv = { PORT: '0', MESHRECEIPT_CORE_ONLY: '1' };
  const core = await createApp({ directory: path.join(output, 'core-store'), staticDirectory, env: coreEnv });
  await new Promise(resolve => core.server.listen(0, '127.0.0.1', resolve));
  try {
    const coreBase = `http://127.0.0.1:${core.server.address().port}`;
    assert.equal((await fetch(`${coreBase}/city/index.html`)).status, 404);
    assert.equal((await fetch(`${coreBase}/city/snapshot/snapshot.json`)).status, 404);
  result.checks.coreModeDoesNotExposeMap = true;
  } finally { core.server.closeAllConnections(); await new Promise(resolve => core.server.close(resolve)); }
  const canLoseContext = await page.locator('#viewport canvas').evaluate(canvas => {
    const extension = canvas.getContext('webgl2').getExtension('WEBGL_lose_context');
    if (!extension) return false; window.testContextRecovery = extension; extension.loseContext(); return true;
  });
  if (canLoseContext) {
    await page.locator('#error').waitFor({ state: 'visible' });
    assert.match(await page.locator('#error').innerText(), /上下文已丢失/); assert.equal(await page.locator('#download').isEnabled(), false);
    await page.waitForTimeout(500); await page.evaluate(() => window.testContextRecovery.restoreContext());
    await ready(); assert.equal(await page.locator('#error').isVisible(), false);
    assert.equal(await page.locator('#download').isEnabled(), true); result.checks.contextLossRecovery = true;
  } else result.checks.contextLossRecovery = 'extension unavailable';
  assert.deepEqual(errors, []);
  assert.ok(requests.every(request => request.method === 'GET'));
  assert.ok(!requests.some(request => /\.(glb|gltf|blend)(\?|$)/.test(request.url)));
  assert.ok(!requests.some(request => !request.url.startsWith(base)));
  result.checks.noModelOrRemoteRequests = true; result.pageErrors = errors; result.status = 'passed';
} catch (error) {
  result.status = 'failed'; result.error = error.message; result.pageErrors = errors;
  await screenshot('failure').catch(() => {}); process.exitCode = 1;
} finally {
  await browser.close(); await app.jobs.idle(); app.server.closeAllConnections(); await new Promise(resolve => app.server.close(resolve));
  await writeFile(path.join(output, 'city-result.json'), `${JSON.stringify(result, null, 2)}\n`, { flag: 'wx' });
  console.log(JSON.stringify({ output, ...result }, null, 2));
}

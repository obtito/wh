// 全地标巡检:逐 POI 取景截图(观察模式自适应距离),验收每处地标的视觉呈现
// 用法: node tools/tour.mjs [端口]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Administrator/Desktop/GTA-SZ/node_modules/playwright/index.js');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8150;
const OUT = resolve(root, 'docs/shots/tour');
mkdirSync(OUT, { recursive: true });

const server = spawn(process.execPath, [resolve(root, 'tools/serve.mjs'), String(PORT)], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 800));

const ALL_POIS = process.argv.slice(3).length ? process.argv.slice(3) : [
  'huanghelou', 'guishantower', 'qingchuan', 'jianghanguan', 'jianghanlu', 'hankoujiangtan',
  'hubsmuseum', 'chuhehanjie', 'hanxiu', 'greenland', 'whu', 'chutiantai', 'opticsvalley',
  'guiyuan', 'guqintai', 'tanhualin', 'honglou',
  'yangtzebridge', 'bridge2', 'yingwuzhou', 'jianghanbridge', 'qingchuanbridge',
];

const errors = [];
try {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  page.on('pageerror', (e) => errors.push(String(e).slice(0, 200)));
  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loading.done', { timeout: 60000 });

  for (const id of ALL_POIS) {
    await page.evaluate((pid) => {
      // 模拟点击列表项 → showPOI → 前往
      const api = window.__hud;
      if (api) api.showPOI(pid);
      const btn = document.querySelector('#poiGoto');
      if (btn) btn.click();
    }, id);
    await page.waitForTimeout(1400);
    await page.screenshot({ path: `${OUT}/${id}.png` });
    console.log('✓', id);
  }
  await browser.close();
} catch (e) {
  console.error('巡检失败:', e.message);
} finally {
  server.kill();
}
console.log(errors.length ? '⚠ ' + errors.join('\n') : '✓ 无页面错误');

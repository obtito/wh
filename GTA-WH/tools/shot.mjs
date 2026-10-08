// 浏览器实测:无头 chromium 打开页面,验证加载/渲染/模式切换,截图到 docs/shots/
// 用法: node tools/shot.mjs [端口]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Administrator/Desktop/GTA-SZ/node_modules/playwright/index.js');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8140;
const OUT = resolve(root, 'docs/shots');
mkdirSync(OUT, { recursive: true });

// 起服务器
const server = spawn(process.execPath, [resolve(root, 'tools/serve.mjs'), String(PORT)], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 800));

const errors = [];
try {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1600, height: 950 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 300)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 300)));

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  // 等加载完成(最多 60s)
  await page.waitForSelector('#loading.done', { timeout: 60000 });
  await page.waitForTimeout(3500);        // 让首帧/烘焙跑完

  await page.screenshot({ path: `${OUT}/01-开场-两江交汇.png` });

  // 驾驶模式
  await page.keyboard.press('2');
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/02-驾驶模式.png` });

  // 夜景
  await page.evaluate(() => { document.querySelector('#timeSlider').value = 20.5; document.querySelector('#timeSlider').dispatchEvent(new Event('input')); });
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/03-夜景-驾驶.png` });

  // 黄鹤楼特写(白天,观察模式 + POI 跳转)
  await page.keyboard.press('1');
  await page.evaluate(() => {
    const s = document.querySelector('#timeSlider');
    s.value = 12.5; s.dispatchEvent(new Event('input'));
    window.__hud?.showPOI('huanghelou');
  });
  await page.waitForTimeout(1200);
  await page.screenshot({ path: `${OUT}/04-黄鹤楼.png` });

  // 无人机
  await page.keyboard.press('3');
  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${OUT}/05-无人机.png` });

  const fps = await page.evaluate(() => document.querySelector('#fpsVal').textContent);
  const stamp = await page.evaluate(() => document.querySelector('#buildStamp').textContent);
  console.log('FPS:', fps, '|', stamp);
  await browser.close();
} catch (e) {
  console.error('截图失败:', e.message);
} finally {
  server.kill();
}
console.log(errors.length ? `⚠ 控制台错误 ${errors.length} 条:\n` + errors.slice(0, 12).join('\n') : '✓ 无控制台错误');
process.exit(0);

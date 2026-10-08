// 穿模巡检:把相机摆到街面高度逐处取景,肉眼可核的"路/楼/树/桥"关系
// 用法: node tools/audit-views.mjs [端口]
import { spawn } from 'node:child_process';
import { mkdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const { chromium } = require('C:/Users/Administrator/Desktop/GTA-SZ/node_modules/playwright/index.js');

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const PORT = Number(process.argv[2]) || 8160;
const OUT = resolve(root, 'docs/shots/audit');
mkdirSync(OUT, { recursive: true });

/* 机位:经纬度 + 高度 + 朝向/俯仰(观测模式 = orbit;此处直接用相机摆位) */
const VIEWS = [
  { name: '01-江汉路街面', lon: 114.2880, lat: 30.5790, h: 9, yaw: 0.72, pitch: -0.05 },
  { name: '02-临街楼群低空', lon: 114.2880, lat: 30.5790, h: 70, yaw: 0.72, pitch: -0.30 },
  { name: '03-解放大道车视', lon: 114.3060, lat: 30.6020, h: 6, yaw: 2.35, pitch: -0.02 },
  { name: '04-武昌老城屋顶', lon: 114.3050, lat: 30.5400, h: 140, yaw: 3.55, pitch: -0.45 },
  { name: '05-黄鹤楼近景', lon: 114.3030, lat: 30.5450, h: 40, yaw: 3.9, pitch: -0.12 },
  { name: '06-长江大桥桥面', lon: 114.2870, lat: 30.5560, h: 30, yaw: 0.30, pitch: -0.05 },
  { name: '07-汉口江滩沿江', lon: 114.2900, lat: 30.5780, h: 16, yaw: 1.0, pitch: -0.06 },
  { name: '08-东湖绿道', lon: 114.3700, lat: 30.5480, h: 35, yaw: 2.0, pitch: -0.20 },
];

const server = spawn(process.execPath, [resolve(root, 'tools/serve.mjs'), String(PORT)], { stdio: 'pipe' });
await new Promise((r) => setTimeout(r, 900));

const errors = [];
try {
  const browser = await chromium.launch({
    executablePath: 'C:/Users/Administrator/AppData/Local/ms-playwright/chromium-1228/chrome-win64/chrome.exe',
  });
  const page = await browser.newPage({ viewport: { width: 1440, height: 860 } });
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text().slice(0, 200)); });
  page.on('pageerror', (e) => errors.push('PAGEERROR: ' + String(e).slice(0, 200)));

  await page.goto(`http://localhost:${PORT}/`, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#loading.done', { timeout: 90000 });
  await page.waitForTimeout(2200);

  // 隐藏 UI,只看画面
  await page.evaluate(() => {
    for (const id of ['topbar', 'tourBar', 'listPanel', 'poiCard', 'mapWrap', 'modeTip', 'helpPanel', 'statusbar']) {
      const el = document.getElementById(id);
      if (el) el.style.display = 'none';
    }
  });

  for (const v of VIEWS) {
    const placed = await page.evaluate((v) => {
      const g = window.__game;
      const T = window.__three;
      if (!g || !T) return false;
      const [x, z] = T.toV2(v.lon, v.lat);
      g.setMode('orbit', true);
      g.camera.position.set(x, v.h, z);
      g.camera.rotation.set(0, 0, 0);
      g.camera.rotateY(v.yaw);
      g.camera.rotateX(v.pitch);
      g.camera.updateMatrixWorld(true);
      return true;
    }, v);
    if (!placed) throw new Error('页面未暴露 __game/__three');
    await page.waitForTimeout(600);
    await page.screenshot({ path: `${OUT}/${v.name}.png` });
    console.log('✓', v.name);
  }
  await browser.close();
} catch (e) {
  console.error('巡检失败:', e.message);
} finally {
  server.kill();
}
console.log(errors.length ? '⚠ ' + errors.join('\n') : '✓ 无页面错误');

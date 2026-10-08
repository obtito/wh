// Sketchfab 武汉真实地标抓取(Void.com 楼群,CC-BY)
// 用法: node tools/fetch_sketchfab.mjs
// 依赖:环境变量 SKETCHFAB_TOKEN(或在此填入)
import { writeFileSync, mkdirSync, existsSync, rmSync } from 'node:fs';
import { execSync } from 'node:child_process';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const TOKEN = process.env.SKETCHFAB_TOKEN || '045f2b87b0c649dbab2a60404b2981bc';
const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const OUT = resolve(ROOT, 'assets/models');
mkdirSync(OUT, { recursive: true });

// Void.com 武汉地标(搜索 API 定位;faceCount 取适合游戏的低面版)
const MODELS = [
  { uid: '795a3cec308d44a985dacfda99239a3e', name: 'wuhan-greenland-center', note: '武汉绿地中心 475m(37.7k 面)' },
  { uid: '413eb58cc89c4423bf51ce63c2ab1393', name: 'wuhan-center', note: '武汉中心 438m(13k 面)' },
  { uid: 'ae06b8933f7e4b5fb749425afb2e454e', name: 'wuhan-ctf-finance', note: '周大福金融中心(9.5k 面)' },
  { uid: 'fc4c62c332234ef6abffac9d87e4bc2f', name: 'wuhan-shipping-center', note: '长江航运中心(18.7k 面)' },
  { uid: 'c5dfa1384c0b4ae3a08a49e2ed7ae2e4', name: 'wuhan-panhai-times', note: '泛海时代中心(7.4k 面)' },
  { uid: '8d56b5d7f23246be91da35b7a33328fe', name: 'yellow-crane-tower', note: '黄鹤楼摄影测量(177k 面)' },
  { uid: 'c29ea5437cfd4569ad86fbefcc64d15b', name: 'tongling-railway-bridge', note: '铜陵长江公铁大桥(245k 面)' },
];

const ATTR = [];

for (const m of MODELS) {
  const dir = resolve(OUT, m.name);
  if (existsSync(resolve(dir, 'scene.gltf'))) {
    console.log(`✓ ${m.name} 已存在,跳过`);
    continue;
  }
  // 1) 元数据:许可证校验(只接受 cc-by / cc0)
  const meta = await fetch(`https://api.sketchfab.com/v3/models/${m.uid}`, {
    headers: { Authorization: `Token ${TOKEN}` },
  }).then((r) => r.json());
  const lic = meta?.license?.slug;
  if (lic !== 'by' && lic !== 'cc0') {
    console.error(`✗ ${m.name} 许可证 ${lic} 不合规,跳过`);
    continue;
  }
  console.log(`↓ ${m.name}(${m.note})license=${lic} faces=${meta.faceCount}`);
  // 2) 下载链接(gltf zip)
  const dl = await fetch(`https://api.sketchfab.com/v3/models/${m.uid}/download`, {
    headers: { Authorization: `Token ${TOKEN}` },
  }).then((r) => r.json());
  const url = dl?.gltf?.url;
  if (!url) { console.error(`  ✗ 无 gltf 下载档:${JSON.stringify(dl).slice(0, 120)}`); continue; }
  // 3) 下载 + 解压
  mkdirSync(dir, { recursive: true });
  const zip = resolve(OUT, `${m.name}.zip`);
  execSync(`curl -sL --max-time 240 -o "${zip}" "${url}"`, { shell: 'cmd.exe' });
  // Windows 自带 bsdtar(支持 zip;Git Bash 的 GNU tar 不支持)
  execSync(`C:\\Windows\\System32\\tar.exe -xf "${zip}" -C "${dir}"`, { stdio: 'inherit' });
  rmSync(zip, { force: true });
  const hasGltf = existsSync(resolve(dir, 'scene.gltf'));
  console.log(`  ${hasGltf ? '✓ 解压完成' : '⚠ 未找到 scene.gltf(检查目录)'}`);
  ATTR.push({ name: m.name, author: meta.user.displayName, url: meta.viewerUrl, license: meta.license.label });
}

// 4) 追加署名
if (ATTR.length) {
  const rows = ATTR.map((a) => `| \`assets/models/${a.name}/\` | [${a.name}](${a.url}) by **${a.author}**(Sketchfab) | ${a.license} | 保留本表即视为署名 |`).join('\n');
  console.log('\n署名行(追加到 docs/ATTRIBUTION.md):\n' + rows);
  writeFileSync(resolve(ROOT, '.tmp_sketchfab_attribution.md'), rows, 'utf8');
}
console.log('完成');

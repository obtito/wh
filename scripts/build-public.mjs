import { mkdir, readFile, writeFile, cp, rm, readdir, stat } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { ensureAssets } from '../meshreceipt/server/assets.js';
import { landmarkCatalog } from '../meshreceipt/server/landmarks.js';
import { readPublishedEvidence } from '../meshreceipt/server/mainnet-evidence.js';
import { RECEIPT_ABI } from '../meshreceipt/src/chain.js';

const root = fileURLToPath(new URL('../', import.meta.url));
const output = path.join(root, 'site');
await rm(output, { recursive: true, force: true });
const build = spawnSync('npm', ['run', 'build', '--', '--outDir', '../site'], {
  cwd: path.join(root, 'meshreceipt'), env: { ...process.env, VITE_PUBLIC_EXHIBITION: '1' }, stdio: 'inherit',
});
if (build.status !== 0) throw new Error('Public build failed');
const generated = path.join(root, 'meshreceipt/data/public-build-assets');
const assets = await ensureAssets(generated);
const landmarks = await landmarkCatalog(root);
if (landmarks.some(item => !item.previewUrl)) throw new Error('Landmark dependency is missing');
async function json(relative, value) {
  const file = path.join(output, relative); await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, JSON.stringify(value));
}
await json('api/assets.json', [...landmarks, ...assets.map(({file, ...asset}) => ({
  ...asset, previewOnly: false, readiness: '公开模型检视 · 任务处理需本机后端',
  modelUrl: `/api/assets/${asset.id}/model.glb`,
}))]);
await json('api/tasks.json', []);
await json('api/config.json', { modelAvailable: false, modelStatus: 'not-configured', chainId: 677,
  contractAddress: '0x60EFB5EcEeD452d57480Af272F8084c8D0d3c5f7', abi: RECEIPT_ABI,
  coreOnly: false, publicExhibition: true });
const evidence = await readPublishedEvidence();
await json('api/mainnet-evidence.json', { ...evidence, status: 'archive-only' });
for (const [route, name] of [['bundle', 'pavilion-qualified.json'], ['failure', 'pavilion-failure.json']]) {
  await json(`api/mainnet-evidence/${route}.json`, JSON.parse(await readFile(path.join(root, 'meshreceipt/docs/evidence', name))));
}
for (const asset of assets) {
  const target = path.join(output, 'api/assets', asset.id, 'model.glb');
  await mkdir(path.dirname(target), { recursive: true }); await cp(asset.file, target);
}
for (const [label, source] of [['nanjing', 'GTA-NJ'], ['wuhan', 'GTA-WH']]) {
  const target = path.join(output, 'api/source', label); await mkdir(target, { recursive: true });
  const sourceRoot = path.join(root, source);
  for (const item of await readdir(sourceRoot)) {
    if (!['js','vendor','css','assets','docs','tools'].includes(item) && !/^preview-(zifeng|gates)\.|^zifeng-(day|night)\.png$/.test(item)) continue;
    await cp(path.join(sourceRoot, item), path.join(target, item), { recursive: true });
  }
}
const gatePage = path.join(output, 'api/source/nanjing/preview-gates.html');
await writeFile(gatePage, (await readFile(gatePage, 'utf8')).replace('<a href="./index.html?lm=none">↗ 返回城市总览</a><br>', '琢信 · 城门检视<br>'));
await writeFile(path.join(output, '.nojekyll'), '');
await json('publication.json', { generatedAt: new Date().toISOString(), mode: 'public-exhibition',
  assets: landmarks.length + assets.length, source: 'https://github.com/obtito/wh',
  taskBackend: false, mainnetStatus: 'archive-only' });
// Verify local module dependency URLs and exported catalog entrypoints before publishing.
let checked = 0;
async function inspect(directory) {
  for (const item of await readdir(directory, { withFileTypes: true })) {
    const file = path.join(directory, item.name);
    if (item.isDirectory()) { await inspect(file); continue; }
    if (!/\.(js|mjs|html)$/.test(item.name)) continue;
    const text = await readFile(file, 'utf8');
    for (const match of text.matchAll(/(?:from\s*|import\s*\(|import\s*|src=)["']([^"']+)["']/g)) {
      const url = match[1];
      if (!url.startsWith('.') && !url.startsWith('/api/source/')) continue;
      if (url.includes('${')) continue;
      const dependency = url.startsWith('/') ? path.join(output, url) : path.resolve(path.dirname(file), url.split(/[?#]/)[0]);
      if (!dependency.startsWith(output + path.sep)) throw new Error(`Dependency escapes output: ${url}`);
      try { if (!(await stat(dependency)).isFile()) throw new Error('not a file'); }
      catch { throw new Error(`Missing dependency in ${path.relative(output, file)}: ${url}`); }
      checked++;
    }
  }
}
// Check the published entrypoints and public preview trees, not upstream development tools.
await inspect(path.join(output, 'previews'));
for (const item of landmarks) for (const url of [item.previewUrl, item.poster]) {
  if (url) await stat(path.join(output, url.split('?')[0]));
}
console.log(JSON.stringify({ status: 'built', assets: landmarks.length + assets.length, checkedDependencies: checked,
  localReceiptVerification: evidence.localVerification.qualified, output }));

// 静态预检:只把源码解析成 ES Module 记录,不执行、不解析依赖、不碰 WebGL/DOM。
// (移植自 GTA-NJ tools/check.mjs —— 主模块一旦语法错误,浏览器整页白屏且无提示)
// 用法: node --experimental-vm-modules tools/check.mjs
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { dirname, join, relative } from 'node:path';
import vm from 'node:vm';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const files = [
  ...readdirSync(join(root, 'js')).filter((f) => f.endsWith('.js')).map((f) => join(root, 'js', f)),
  ...readdirSync(join(root, 'tools')).filter((f) => f.endsWith('.mjs')).map((f) => join(root, 'tools', f)),
];

if (typeof vm.SourceTextModule !== 'function') {
  console.error('需要 --experimental-vm-modules:node --experimental-vm-modules tools/check.mjs');
  process.exit(2);
}

let bad = 0;
for (const f of files) {
  try {
    new vm.SourceTextModule(readFileSync(f, 'utf8'), { identifier: pathToFileURL(f).href });
  } catch (e) {
    bad++;
    console.error(`✗ ${relative(root, f)}  ${e.message}`);
    const loc = e.stack?.match(/<anonymous>:(\d+)/);
    if (loc) console.error(`    .js:${loc[1]}`);
  }
}
console.log(bad ? `语法预检失败:${bad}/${files.length} 个文件有语法错误` : `语法预检通过:${files.length} 个文件`);
process.exit(bad ? 1 : 0);

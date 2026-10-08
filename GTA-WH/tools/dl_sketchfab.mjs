// Sketchfab 慢链路下载器:签名 URL 5 分钟过期,断点续传 + 每轮刷新 URL
// 用法: node tools/dl_sketchfab.mjs <uid> <输出.zip> [期望字节数]
import { statSync } from 'node:fs';
import { execSync } from 'node:child_process';

const TOKEN = process.env.SKETCHFAB_TOKEN || '045f2b87b0c649dbab2a60404b2981bc';
const [uid, out, expectArg] = process.argv.slice(2);

for (let round = 1; round <= 10; round++) {
  const info = JSON.parse(execSync(
    `curl -sL --max-time 15 -H "Authorization: Token ${TOKEN}" "https://api.sketchfab.com/v3/models/${uid}/download"`,
  ).toString());
  const url = info?.gltf?.url;
  const expect = Number(expectArg) || info?.gltf?.size;
  if (!url) { console.error('无下载 URL:', JSON.stringify(info).slice(0, 120)); process.exit(1); }
  let have = 0;
  try { have = statSync(out).size; } catch {}
  console.log(`第 ${round} 轮:已有 ${have} / ${expect} 字节`);
  if (expect && have >= expect) { console.log('✓ 下载完成'); process.exit(0); }
  try {
    execSync(`curl -sL -C - --max-time 280 -o "${out}" "${url}"`, { timeout: 300000 });
  } catch { /* 超时/中断:下一轮换新 URL 续传 */ }
}
console.error('10 轮仍未完成');
process.exit(1);

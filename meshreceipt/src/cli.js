import { readFile, writeFile } from 'node:fs/promises';
import { verifyDelivery } from './receipt.js';

const [inputPath, outputPath, policyPath, reportPath] = process.argv.slice(2);
if (!inputPath || !outputPath || !policyPath) {
  console.error('Usage: npm run verify -- original.glb delivery.glb policy.json [report.json]');
  process.exitCode = 3;
} else {
  try {
    const [input, output, policyJSON] = await Promise.all([readFile(inputPath), readFile(outputPath), readFile(policyPath, 'utf8')]);
    const report = await verifyDelivery(input, output, JSON.parse(policyJSON));
    const json = `${JSON.stringify(report, null, 2)}\n`;
    if (reportPath) await writeFile(reportPath, json, { flag: 'wx' });
    process.stdout.write(json);
    process.exitCode = report.verdict === 'PASS' ? 0 : report.verdict === 'FAIL' ? 1 : 2;
  } catch (error) {
    console.error(JSON.stringify({ verdict: 'ERROR', reason: error.message }));
    process.exitCode = 3;
  }
}

import { readFile, writeFile } from 'node:fs/promises';
import { optimizeTexture, verifyDelivery } from '../src/receipt.js';

process.once('message', async job => {
  try {
    const original = new Uint8Array(await readFile(job.inputPath));
    const output = await optimizeTexture(original, { fault: job.fault });
    const report = await verifyDelivery(original, output, job.policy);
    await writeFile(job.outputPath, output, { flag: 'wx' });
    await writeFile(job.reportPath, `${JSON.stringify(report, null, 2)}\n`, { flag: 'wx' });
    process.send({ ok: true, report });
  } catch (error) { process.send({ ok: false, error: error.message }); }
  finally { process.disconnect(); }
});

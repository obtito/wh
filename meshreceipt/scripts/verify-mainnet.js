import { mkdir, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { checkPublishedMainnet } from '../server/mainnet-evidence.js';

const args = process.argv.slice(2);
if (args.length && (args.length !== 2 || args[0] !== '--out')) throw new Error('Usage: node scripts/verify-mainnet.js [--out NEW_FILE]');
try {
  const evidence = await checkPublishedMainnet();
  if (args.length) {
    await mkdir(path.dirname(path.resolve(args[1])), { recursive: true });
    await writeFile(args[1], `${JSON.stringify(evidence, null, 2)}\n`, { flag: 'wx' });
  }
  console.log(JSON.stringify(evidence, null, 2));
} catch (error) {
  console.error(JSON.stringify({ status: 'read-failed', verifiedNow: false, archivedEvidenceAvailable: true,
    error: error.shortMessage || error.message, transactionSent: false })); process.exitCode = 1;
}

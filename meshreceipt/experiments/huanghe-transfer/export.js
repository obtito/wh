import { exportTransport } from './delivery.js';

try {
  const [directory, ...args] = process.argv.slice(2), options = {};
  if (!directory || args.length % 2) throw new Error('Usage: node experiments/huanghe-transfer/export.js DIRECTORY --issuer ADDRESS --instance UUID --provider ID --input-hash ORIGINAL_SHA256 --out NEW_DIRECTORY');
  for (let i = 0; i < args.length; i += 2) {
    if (!['--issuer', '--instance', '--provider', '--input-hash', '--out'].includes(args[i]) || options[args[i]] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid export options');
    options[args[i]] = args[i + 1];
  }
  if (!options['--out']) throw new Error('A new output directory is required');
  const result = await exportTransport(directory, { issuer: options['--issuer'], instance: options['--instance'], providerId: options['--provider'], inputHash: options['--input-hash'] }, options['--out']);
  console.log(JSON.stringify(result, null, 2));
} catch (error) { console.error(JSON.stringify({ exported: false, error: error.message })); process.exitCode = 3; }

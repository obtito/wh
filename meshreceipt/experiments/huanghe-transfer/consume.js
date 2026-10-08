import { consumeTask } from './delivery.js';

try {
  const [directory, ...args] = process.argv.slice(2), options = {};
  if (!directory || args.length % 2) throw new Error('Usage: node experiments/huanghe-transfer/consume.js DIRECTORY --issuer ADDRESS --instance UUID --provider ID --input-hash ORIGINAL_SHA256 [--out NEW_DIRECTORY]');
  for (let i = 0; i < args.length; i += 2) {
    if (!['--issuer', '--instance', '--provider', '--input-hash', '--out'].includes(args[i]) || options[args[i]] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid consumer options');
    options[args[i]] = args[i + 1];
  }
  const result = await consumeTask(directory, { issuer: options['--issuer'], instance: options['--instance'], providerId: options['--provider'], inputHash: options['--input-hash'] }, options['--out']);
  console.log(JSON.stringify(result, null, 2));
  process.exitCode = result.verdict === 'PASS' ? 0 : result.verdict === 'FAIL' ? 1 : 2;
} catch (error) { console.error(JSON.stringify({ verified: false, error: error.message })); process.exitCode = 3; }

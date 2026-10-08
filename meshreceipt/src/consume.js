import { consumeBundle } from './bundle.js';

try {
  const [file, ...args] = process.argv.slice(2), options = {};
  if (!file || args.length % 2) throw new Error('Usage: npm run consume -- bundle.json --issuer ADDRESS --instance UUID --provider PROVIDER_ID [--out NEW_DIRECTORY]');
  for (let i = 0; i < args.length; i += 2) {
    const key = args[i];
    if (!['--issuer', '--instance', '--provider', '--out'].includes(key) || options[key] || !args[i + 1] || args[i + 1].startsWith('--')) throw new Error('Invalid or duplicate consumer option');
    options[key] = args[i + 1];
  }
  const result = await consumeBundle(file, { issuer: options['--issuer'], instance: options['--instance'], providerId: options['--provider'] }, options['--out']);
  process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
  // Valid failure evidence is not a qualified asset. Exit codes preserve that distinction.
  process.exitCode = result.qualified ? 0 : result.verdict === 'FAIL' ? 1 : 2;
} catch (error) {
  console.error(JSON.stringify({ verified: false, error: error.message }));
  process.exitCode = 3;
}

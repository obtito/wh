import { fork } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { POLICY } from './codec.js';

const args = process.argv.slice(2);
if (args.some(a => a !== '--negative-control') || args.length > 1) throw new Error('Usage: node experiments/huanghe-transfer/run.js [--negative-control]');
const base = fileURLToPath(new URL('../../data/large-tasks/', import.meta.url));
await mkdir(base, { recursive: true, mode: 0o700 });
const negativeControl = args.includes('--negative-control');
const directory = path.join(base, `huanghe-${negativeControl ? 'negative' : 'delivery'}-${randomUUID()}`);
const options = {
  inputFile: fileURLToPath(new URL('../../public/previews/models/huanghe-blender/refined.glb', import.meta.url)),
  sourceFile: fileURLToPath(new URL('../../public/previews/models/huanghe-blender/source.json', import.meta.url)),
  outputDirectory: directory, policy: POLICY, negativeControl,
};
const child = fork(new URL('./worker.js', import.meta.url), [], {
  stdio: ['ignore', 'ignore', 'pipe', 'ipc'], execArgv: ['--max-old-space-size=256'],
});
// Bound wall time, not just JS heap; this is not an OS sandbox or an RSS cap.
try {
  const result = await new Promise((resolve, reject) => {
    let settled = false, diagnostic = '';
    const finish = (error, value) => {
      if (settled) return; settled = true; clearTimeout(timer);
      error ? reject(error) : resolve(value);
    };
    const timer = setTimeout(() => { child.kill('SIGKILL'); finish(new Error('Isolated worker exceeded 60 seconds')); }, 60_000);
    child.stderr.on('data', bytes => { diagnostic = `${diagnostic}${bytes}`.slice(-2000); });
    child.on('error', error => finish(error));
    child.on('exit', code => { if (!settled) finish(new Error(`Worker stopped (${code}): ${diagnostic}`)); });
    child.on('message', message => message.ok ? finish(null, message.result) : finish(new Error(message.error)));
    child.send(options);
  });
  console.log(JSON.stringify(result, null, 2));
} catch (error) {
  await writeFile(path.join(base, `${path.basename(directory)}-error.json`), JSON.stringify({ complete: false,
    outputDirectory: directory, error: error.message, redistributionAuthorized: false }, null, 2), { flag: 'wx', mode: 0o600 });
  console.error(JSON.stringify({ complete: false, error: error.message })); process.exitCode = 1;
} finally { if (child.connected) child.disconnect(); child.kill('SIGTERM'); }

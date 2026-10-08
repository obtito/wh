import { mkdir, mkdtemp } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { build } from 'vite';
import { createApp } from '../server/index.js';

// A fresh build and store never replace dist/ or touch a running instance's tasks.
// Startup makes no model calls. Each live task still needs the UI's explicit consent.
const project = fileURLToPath(new URL('../', import.meta.url));
const parent = path.join(project, 'data', 'isolated-demos');
await mkdir(parent, { recursive: true, mode: 0o700 });
const session = await mkdtemp(path.join(parent, 'session-'));
const staticDirectory = path.join(session, 'frontend');
await build({ root: project, build: { outDir: staticDirectory, emptyOutDir: true } });
const env = { ...process.env, PORT: '0' };
const app = await createApp({ directory: path.join(session, 'private-store'), staticDirectory, env });
app.server.on('error', error => { console.error(`Isolated demo failed: ${error.message}`); process.exitCode = 1; });
app.server.listen(0, '127.0.0.1', () => {
  env.PORT = String(app.server.address().port);
  console.log(`Isolated MeshReceipt: http://127.0.0.1:${env.PORT}`);
  console.log(`Session retained at: ${session}`);
  console.log('No live call on startup. Do not share private-store/ or .env. No mainnet transactions are sent.');
});
let stopping = false;
async function stop() {
  if (stopping) return;
  stopping = true;
  app.server.close();
  await app.jobs.idle();
  app.server.closeAllConnections();
}
process.on('SIGINT', stop);
process.on('SIGTERM', stop);

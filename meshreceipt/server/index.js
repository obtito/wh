import http from 'node:http';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { readFile, realpath, stat } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { ensureAssets } from './assets.js';
import { landmarkCatalog } from './landmarks.js';
import { createStore, validId } from './store.js';
import { createJobs } from './jobs.js';
import { createBundleExporter } from './bundles.js';
import { liveConfigured, modelSettings } from './agent.js';
import { RECEIPT_ABI } from '../src/chain.js';
import { fileCacheHeaders } from './file-cache.js';
import { checkPublishedMainnet, readPublishedEvidence, evidenceFile } from './mainnet-evidence.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const contentTypes = { '.html': 'text/html; charset=utf-8', '.js': 'text/javascript; charset=utf-8', '.mjs': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8', '.json': 'application/json; charset=utf-8', '.md': 'text/plain; charset=utf-8',
  '.glb': 'model/gltf-binary', '.gltf': 'model/gltf+json', '.bin': 'application/octet-stream', '.wasm': 'application/wasm',
  '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.webp': 'image/webp', '.svg': 'image/svg+xml' };

async function sendFile(request, response, file, boundary, allowImmutable = false) {
  const [resolved, root] = await Promise.all([realpath(file), realpath(boundary)]);
  if (!resolved.startsWith(`${root}${path.sep}`) || !contentTypes[path.extname(resolved)]) throw new Error('File is not allowed');
  const info = await stat(resolved); if (!info.isFile()) throw new Error('Not a file');
  const cache = fileCacheHeaders(resolved, info, request.headers, allowImmutable);
  if (cache.unchanged) { response.writeHead(304, cache.headers); response.end(); return; }
  response.writeHead(200, { 'content-type': contentTypes[path.extname(resolved)], 'content-length': info.size,
    'x-content-type-options': 'nosniff', ...cache.headers });
  const stream = createReadStream(resolved); stream.on('error', () => response.destroy()); stream.pipe(response);
}
function json(response, code, value) {
  response.writeHead(code, { 'content-type': 'application/json; charset=utf-8', 'x-content-type-options': 'nosniff', 'cache-control': 'no-store' });
  response.end(JSON.stringify(value));
}
async function requestBody(request) {
  if (!request.headers['content-type']?.startsWith('application/json') || request.headers['x-meshreceipt'] !== 'local-demo') throw new Error('JSON and local-demo header required');
  const chunks = []; let size = 0;
  for await (const chunk of request) { size += chunk.length; if (size > 4096) throw new Error('Request body too large'); chunks.push(chunk); }
  return JSON.parse(Buffer.concat(chunks).toString('utf8'));
}

export async function createApp({ directory = path.join(project, 'data'), workspace = path.dirname(project), staticDirectory = path.join(project, 'dist'), env = process.env, fetcher = fetch } = {}) {
  const store = await createStore(directory);
  const assets = await ensureAssets(path.join(directory, 'assets'));
  const coreOnly = env.MESHRECEIPT_CORE_ONLY === '1';
  const landmarks = coreOnly ? [] : await landmarkCatalog(workspace);
  const jobs = await createJobs(store, assets, { env, fetcher });
  const exportBundle = createBundleExporter(store);
  const server = http.createServer(async (request, response) => {
    try {
      // Loopback binding alone does not prevent DNS rebinding.
      const host = new URL(`http://${request.headers.host || ''}`);
      if (!['127.0.0.1', 'localhost', '[::1]'].includes(host.hostname)) return json(response, 403, { error: 'Only loopback hosts are allowed' });
      const url = new URL(request.url, 'http://127.0.0.1');
      const origin = request.headers.origin;
      if (request.method !== 'GET' && origin) {
        const parsed = new URL(origin);
        if (!['127.0.0.1', 'localhost'].includes(parsed.hostname) || !['5173', '4318', '4173', String(env.PORT || 4318)].includes(parsed.port)) {
          return json(response, 403, { error: 'Cross-origin writes are disabled' });
        }
      }
      if (request.method === 'GET' && url.pathname === '/api/config') return json(response, 200, {
        modelAvailable: liveConfigured(env), modelStatus: liveConfigured(env) ? 'configured-unverified' : 'not-configured',
        modelName: liveConfigured(env) ? modelSettings(env).model : null,
        modelReasoningEffort: liveConfigured(env) ? modelSettings(env).reasoningEffort : null, chainId: Number(env.MESHRECEIPT_CHAIN_ID || 677),
        contractAddress: env.MESHRECEIPT_CONTRACT_ADDRESS || null, abi: RECEIPT_ABI, coreOnly,
        trust: '两个服务及验收器由同一团队控制；签名与上链不构成独立质量证明。',
      });
      if (request.method === 'GET' && url.pathname === '/api/assets') return json(response, 200, [...landmarks, ...assets.map(({ file, ...asset }) => ({ ...asset, previewOnly: false, readiness: '可运行验收样例' }))]);
      if (request.method === 'GET' && url.pathname === '/api/providers') return json(response, 200, store.publicProviders());
      if (request.method === 'GET' && url.pathname === '/api/mainnet-evidence') {
        try { return json(response, 200, await readPublishedEvidence()); }
        catch (error) { if (error.code === 'ENOENT') return json(response, 200, { available: false }); throw error; }
      }
      if (request.method === 'POST' && url.pathname === '/api/mainnet-evidence/verify') {
        const body = await requestBody(request);
        if (Object.keys(body).length) throw new Error('主网只读核对不接受其他网络、地址或任务');
        return json(response, 200, await checkPublishedMainnet());
      }
      if (request.method === 'GET' && ['/api/mainnet-evidence/bundle', '/api/mainnet-evidence/failure'].includes(url.pathname)) {
        const name = url.pathname.endsWith('/failure') ? 'pavilion-failure.json' : 'pavilion-qualified.json';
        return await sendFile(request, response, evidenceFile(name), path.dirname(fileURLToPath(evidenceFile(name))));
      }
      if (request.method === 'GET' && url.pathname === '/api/tasks') return json(response, 200, await store.list());
      if (request.method === 'POST' && url.pathname === '/api/tasks') return json(response, 202, await jobs.create(await requestBody(request)));
      let match = url.pathname.match(/^\/api\/assets\/([a-z-]+)\/model$/);
      if (request.method === 'GET' && match) {
        const asset = assets.find(item => item.id === match[1]); if (!asset) return json(response, 404, { error: 'Asset not found' });
        return await sendFile(request, response, asset.file, directory);
      }
      match = url.pathname.match(/^\/api\/tasks\/([\w-]+)$/);
      if (request.method === 'GET' && match) return json(response, 200, await store.get(match[1]));
      match = url.pathname.match(/^\/api\/tasks\/([\w-]+)\/(policy|original)$/);
      if (request.method === 'GET' && match) {
        const task = await store.get(match[1]);
        if (match[2] === 'policy') return json(response, 200, task.policy);
        return await sendFile(request, response, path.join(store.taskPath(task.id), 'original.glb'), directory);
      }
      match = url.pathname.match(/^\/api\/tasks\/([\w-]+)\/attempts\/([\w-]+)\/bundle$/);
      if (request.method === 'POST' && match) {
        const result = await exportBundle(match[1], match[2], await requestBody(request));
        response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store',
          'x-content-type-options': 'nosniff', 'content-disposition': `attachment; filename="${result.filename}"` });
        return response.end(result.serialized);
      }
      match = url.pathname.match(/^\/api\/tasks\/([\w-]+)\/attempts\/([\w-]+)\/(model|report|verify)$/);
      if (match) {
        validId(match[1]); validId(match[2]);
        if (request.method === 'POST' && match[3] === 'verify') {
          await requestBody(request); return json(response, 200, await jobs.reverify(match[1], match[2]));
        }
        if (request.method === 'GET' && match[3] !== 'verify') {
          const task = await store.get(match[1]);
          if (!task.attempts.some(a => a.id === match[2] && a.status === 'COMPLETED')) return json(response, 404, { error: 'Attempt not completed' });
          return await sendFile(request, response, path.join(store.taskPath(task.id), match[2], match[3] === 'model' ? 'model.glb' : 'report.json'), directory);
        }
      }
      match = url.pathname.match(/^\/api\/source\/(nanjing|wuhan)\/(.+)$/);
      if (request.method === 'GET' && match) {
        if (coreOnly) return json(response, 404, { error: '核心交付包不包含地标源文件' });
        const relative = decodeURIComponent(match[2]);
        if (relative.split('/').some(part => part.startsWith('.') || part.includes('\\')) || path.isAbsolute(relative)
          || !/^(js\/|vendor\/|css\/|assets\/|tools\/osm\/|docs\/|preview-zifeng\.|preview-gates\.|zifeng-day\.png$|zifeng-night\.png$)/.test(relative)) return json(response, 403, { error: 'Source path is not allowed' });
        const root = path.join(workspace, match[1] === 'nanjing' ? 'GTA-NJ' : 'GTA-WH');
        if (match[1] === 'nanjing' && relative === 'preview-gates.html') {
          const html = (await readFile(path.join(root, relative), 'utf8')).replace('<a href="./index.html?lm=none">↗ 返回城市总览</a><br>', '琢信 · 城门检视<br>');
          response.writeHead(200, { 'content-type': contentTypes['.html'], 'x-content-type-options': 'nosniff', 'cache-control': 'no-cache' });
          return response.end(html);
        }
        return await sendFile(request, response, path.join(root, relative), root);
      }
      if (url.pathname.startsWith('/api/')) return json(response, 404, { error: 'Not found' });
      if (coreOnly && (url.pathname === '/city' || url.pathname.startsWith('/city/'))) return json(response, 404, { error: '核心交付版不包含城市底图和共建预览' });
      if (request.method !== 'GET') return json(response, 405, { error: 'Method not allowed' });
      const dist = staticDirectory;
      const relative = decodeURIComponent(url.pathname).replace(/^\/+/, '');
      if (relative.split('/').some(part => part.startsWith('.') || part.includes('\\'))) return json(response, 403, { error: 'Not allowed' });
      try { return await sendFile(request, response, path.join(dist, relative || 'index.html'), dist, true); }
      catch (error) { if (error.code !== 'ENOENT') throw error; return await sendFile(request, response, path.join(dist, 'index.html'), dist, true); }
    } catch (error) {
      if (!response.headersSent) json(response, error.code === 'ENOENT' ? 404 : 400, { error: error.message });
      else response.destroy();
    }
  });
  server.requestTimeout = 15_000;
  return { server, store, jobs, assets, exportBundle };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const { server } = await createApp();
  const port = Number(process.env.PORT || 4318);
  server.on('error', error => { console.error(`Cannot start local server: ${error.message}`); process.exitCode = 1; });
  server.listen(port, '127.0.0.1', () => console.log(`MeshReceipt: http://127.0.0.1:${port} (localhost-only, no live model calls unless configured)`));
}

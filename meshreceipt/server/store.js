import { mkdir, readFile, readdir, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { randomUUID } from 'node:crypto';
import { Wallet, verifyMessage } from 'ethers';
import { hashJSON } from '../src/receipt.js';

export const ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;
export function validId(id) { if (!ID_PATTERN.test(id)) throw new Error('Invalid id'); return id; }
export async function atomicJSON(file, value) {
  const temporary = `${file}.${randomUUID()}.tmp`;
  await writeFile(temporary, `${JSON.stringify(value, null, 2)}\n`, { mode: 0o600 });
  await rename(temporary, file);
}

export async function createStore(directory) {
  await mkdir(directory, { recursive: true, mode: 0o700 });
  const tasksDir = path.join(directory, 'tasks'); await mkdir(tasksDir, { recursive: true });
  const identitiesPath = path.join(directory, '.demo-identities.json');
  let identities;
  try { identities = JSON.parse(await readFile(identitiesPath, 'utf8')); }
  catch (error) {
    if (error.code !== 'ENOENT') throw error;
    identities = { instance: randomUUID(), rapid: Wallet.createRandom().privateKey, careful: Wallet.createRandom().privateKey };
    await writeFile(identitiesPath, JSON.stringify(identities), { flag: 'wx', mode: 0o600 });
  }
  const providers = [
    { id: 'rapid-demo', agentId: 'service-a', name: '服务 A', description: '限定 GLB 的纹理处理适配器；履约结果需实际验收。', costUnits: 1, fault: 'drop-animation', wallet: new Wallet(identities.rapid) },
    { id: 'careful-demo', agentId: 'service-b', name: '服务 B', description: '限定 GLB 的纹理处理适配器；履约结果需实际验收。', costUnits: 2, fault: null, wallet: new Wallet(identities.careful) },
  ];
  const taskPath = id => path.join(tasksDir, validId(id));
  const message = payload => `meshreceipt.delivery.v1:${identities.instance}:${hashJSON(payload)}`;
  return {
    directory, providers,
    taskPath,
    async save(task) { await mkdir(taskPath(task.id), { recursive: true }); await atomicJSON(path.join(taskPath(task.id), 'task.json'), task); },
    async get(id) { return JSON.parse(await readFile(path.join(taskPath(id), 'task.json'), 'utf8')); },
    async list() {
      const ids = (await readdir(tasksDir)).filter(id => ID_PATTERN.test(id));
      const tasks = await Promise.all(ids.map(async id => { try { return await this.get(id); } catch { return null; } }));
      return tasks.filter(Boolean).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    },
    async signDelivery(providerId, payload) {
      const provider = providers.find(item => item.id === providerId);
      if (!provider) throw new Error('Unknown provider');
      return { scheme: 'meshreceipt.delivery.v1/EIP-191', instance: identities.instance, issuer: provider.wallet.address,
        payload, signature: await provider.wallet.signMessage(message(payload)) };
    },
    verifyDeliverySignature(attestation) {
      try {
        const provider = providers.find(item => item.id === attestation.payload.providerId);
        return Boolean(provider && attestation.instance === identities.instance
          && attestation.issuer === provider.wallet.address
          && verifyMessage(message(attestation.payload), attestation.signature) === provider.wallet.address);
      } catch { return false; }
    },
    publicProviders() { return providers.map(({ wallet, fault, ...provider }) => ({ ...provider, issuer: wallet.address, demo: true })); },
  };
}

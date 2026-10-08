import path from 'node:path';
import { createBundle, verifyBundle, readBoundedFile, MAX_BUNDLE_BYTES, bundleSealMessage, BUNDLE_SCHEMA } from '../src/bundle.js';
import { LIMITS } from '../src/receipt.js';
import { validId } from './store.js';

export function createBundleExporter(store) {
  let busy = false;
  return async (taskId, attemptId, options) => {
    if (!options || Object.keys(options).sort().join(',') !== 'confirmDistribution,kind'
      || options.confirmDistribution !== true || !['qualified', 'evidence'].includes(options.kind)) {
      throw new Error('Choose a bundle kind and explicitly confirm distribution of the original and output');
    }
    if (busy) throw new Error('Bundle verification is busy; retry after it finishes');
    busy = true;
    try {
      validId(taskId); validId(attemptId);
      const task = await store.get(taskId), attempt = task.attempts.find(item => item.id === attemptId);
      if (!attempt || attempt.status !== 'COMPLETED') throw new Error('No completed attempt to export');
      if (options.kind === 'qualified' && attempt.verdict !== 'PASS') throw new Error('Only PASS can be exported as a qualified asset; diagnostic downloads remain available');
      if (!task.distributionSource) throw new Error('No frozen distribution authorization; create a new task with an authorized sample');
      const provider = store.publicProviders().find(item => item.id === attempt.providerId);
      if (!provider || !store.verifyDeliverySignature(attempt.delivery)) throw new Error('Delivery signature is not trusted');
      const folder = path.join(store.taskPath(task.id), attempt.id);
      const [input, output, rawReport] = await Promise.all([
        readBoundedFile(path.join(store.taskPath(task.id), 'original.glb'), LIMITS.bytes),
        readBoundedFile(path.join(folder, 'model.glb'), LIMITS.bytes),
        readBoundedFile(path.join(folder, 'report.json'), 512 * 1024),
      ]);
      const report = JSON.parse(rawReport.toString('utf8'));
      if (report.verdict !== attempt.verdict) throw new Error('Stored attempt/report verdict mismatch');
      const bundle = await createBundle({ task, attempt, source: task.distributionSource, input, output, report, kind: options.kind,
        signSeal: async manifestHash => {
          // Same team-controlled demo identity; this is a publisher declaration, not an independent rights certification.
          const signer = store.providers.find(item => item.id === attempt.providerId);
          return { scheme: `${BUNDLE_SCHEMA}/EIP-191`, instance: attempt.delivery.instance, issuer: provider.issuer,
            manifestHash, signature: await signer.wallet.signMessage(bundleSealMessage(attempt.delivery.instance, manifestHash)) };
        },
      });
      // Recheck the exact byte snapshot that will be returned, including a fresh independent recomputation.
      await verifyBundle(bundle, { issuer: provider.issuer, instance: attempt.delivery.instance, providerId: attempt.providerId });
      const serialized = JSON.stringify(bundle);
      if (Buffer.byteLength(serialized) > MAX_BUNDLE_BYTES) throw new Error('Bundle exceeds size limit');
      return { serialized, filename: `meshreceipt-${options.kind}-${task.id}-${attempt.id}.json` };
    } finally { busy = false; }
  };
}

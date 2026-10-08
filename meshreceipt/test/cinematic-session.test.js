import test from 'node:test';
import assert from 'node:assert/strict';
import { acceptCinematicStatus, cinematicPoster } from '../web/cinematic-session.js';
import { retainPreviewEntries } from '../web/preview-cache.js';

const preparing = { url: '/previews/zifeng.html', requestId: 'entrance-2', phase: 'preparing' };
test('only the active entrance may reveal its real-time scene', () => {
  for (const [session, message, activeUrl] of [
    [null, { requestId: preparing.requestId, status: 'started' }, preparing.url],
    [preparing, { requestId: 'entrance-1', status: 'started' }, preparing.url],
    [preparing, { requestId: preparing.requestId, status: 'started' }, '/previews/wuhan.html'],
    [preparing, { requestId: preparing.requestId, status: 'unexpected' }, preparing.url],
  ]) assert.equal(acceptCinematicStatus(session, message, activeUrl), session);
  assert.equal(acceptCinematicStatus(preparing, { requestId: preparing.requestId, status: 'started' }, preparing.url).phase, 'running');
});
test('finished or skipped entrances reject late start messages and retain measured results', () => {
  for (const status of ['complete', 'skipped']) {
    const metrics = { frames: 90, p95Ms: 17.1 };
    const complete = acceptCinematicStatus(preparing, { requestId: preparing.requestId, status, metrics }, preparing.url);
    assert.equal(complete.phase, 'complete');
    assert.deepEqual(complete.metrics, metrics);
    assert.equal(acceptCinematicStatus(complete, { requestId: preparing.requestId, status: 'started' }, preparing.url), complete);
  }
});
test('warm iframe reopens do not replay an entrance or reset the camera', () => {
  const asset = { previewUrl: preparing.url, title: '紫峰大厦' };
  const ready = { url: asset.previewUrl, title: asset.title, revision: 0, status: 'ready', cinematicPlayed: true };
  const result = retainPreviewEntries([ready], asset);
  assert.equal(result.length, 1);
  assert.equal(result[0], ready);
  assert.equal(result[0].cinematicPlayed, true);
  const evicted = retainPreviewEntries([], asset)[0];
  assert.equal(evicted.status, 'loading');
  assert.ok(!evicted.cinematicPlayed);
});
test('cinematic texture reuses the optimized local cover format', () => {
  assert.equal(cinematicPoster('/previews/zifeng-poster-cinematic.png'), '/previews/zifeng-poster-cinematic.webp');
  assert.equal(cinematicPoster('/previews/cover.jpg'), '/previews/cover.jpg');
  assert.equal(cinematicPoster(undefined), undefined);
});

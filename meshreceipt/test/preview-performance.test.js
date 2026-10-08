import test from 'node:test';
import assert from 'node:assert/strict';
import { fileCacheHeaders } from '../server/file-cache.js';
import { retainPreviewEntries } from '../web/preview-cache.js';

const info = { size: 12345, mtimeMs: 1730000000123.5, mtime: new Date(1730000000123.5) };
test('source/model URLs revalidate without downloading unchanged bytes', () => {
  for (const file of ['/source/vendor/three.module.js', '/dist/previews/wuhan.html', '/source/assets/model.glb']) {
    const first = fileCacheHeaders(file, info);
    assert.equal(first.unchanged, false); assert.match(first.headers['cache-control'], /must-revalidate/);
    assert.equal(fileCacheHeaders(file, info, { 'if-none-match': first.headers.etag }).unchanged, true);
    assert.equal(fileCacheHeaders(file, { ...info, mtimeMs: info.mtimeMs + 0.5 }, { 'if-none-match': first.headers.etag }).unchanged, false);
    assert.equal(fileCacheHeaders(file, { ...info, size: info.size + 1 }, { 'if-none-match': first.headers.etag }).unchanged, false);
    assert.equal(fileCacheHeaders(file, info, { 'if-none-match': '"other"', 'if-modified-since': info.mtime.toUTCString() }).unchanged, false);
  }
});
test('only content-hashed build resources use long-lived caching', () => {
  assert.match(fileCacheHeaders('/dist/assets/index-B1_qNGKe.js', info, {}, true).headers['cache-control'], /immutable/);
  for (const file of ['/dist/previews/wuhan.js', '/dist/assets/module.js', '/dist/index.html']) {
    assert.doesNotMatch(fileCacheHeaders(file, info, {}, true).headers['cache-control'], /immutable/);
  }
  assert.doesNotMatch(fileCacheHeaders('/source/assets/building-original.js', info).headers['cache-control'], /immutable/);
});
test('preview cache retains two recently used URLs and revisiting does not duplicate one', () => {
  const asset = id => ({ title: id, previewUrl: `/previews/${id}.html` });
  let entries = retainPreviewEntries([], asset('a'));
  entries[0] = { ...entries[0], status: 'ready', revision: 1 };
  entries = retainPreviewEntries(entries, asset('b'));
  entries = retainPreviewEntries(entries, asset('a'));
  assert.deepEqual(entries.map(item => item.url), ['/previews/b.html', '/previews/a.html']);
  assert.equal(entries.at(-1).status, 'ready', 'reopening a ready frame must not cover it with the loading poster again');
  assert.equal(entries.at(-1).revision, 1, 'LRU movement must not change the iframe key and reload it');
  entries = retainPreviewEntries(entries, asset('c'));
  assert.deepEqual(entries.map(item => item.url), ['/previews/a.html', '/previews/c.html']);
  assert.equal(retainPreviewEntries(entries, null), entries);
  assert.equal(retainPreviewEntries(entries, { modelUrl: '/lab/model.glb' }), entries);
  const reopened = retainPreviewEntries(entries, asset('b')).at(-1);
  assert.equal(reopened.status, 'loading', 'an evicted frame needs a new model-first-frame signal');
});

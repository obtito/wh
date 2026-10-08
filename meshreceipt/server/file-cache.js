// Unversioned source/model URLs revalidate so edits are visible immediately.
// Only Vite's content-hashed build artifacts can skip revalidation entirely.
export function fileCacheHeaders(file, info, requestHeaders = {}, allowImmutable = false) {
  const etag = `W/"${info.size.toString(16)}-${info.mtimeMs.toString(16)}"`;
  const headers = {
    etag, 'last-modified': info.mtime.toUTCString(),
    'cache-control': allowImmutable && /[/\\]assets[/\\][^/\\]+-[\w-]{8,}\.(js|css)$/.test(file)
      ? 'private, max-age=31536000, immutable' : 'private, max-age=0, must-revalidate',
  };
  const candidates = requestHeaders['if-none-match'];
  const unchanged = typeof candidates === 'string'
    ? candidates.split(',').some(value => value.trim() === '*' || value.trim().replace(/^W\//, '') === etag.replace(/^W\//, ''))
    : requestHeaders['if-modified-since'] && Number.isFinite(Date.parse(requestHeaders['if-modified-since']))
      && Math.floor(info.mtimeMs / 1000) * 1000 <= Date.parse(requestHeaders['if-modified-since']);
  return { headers, unchanged: Boolean(unchanged) };
}

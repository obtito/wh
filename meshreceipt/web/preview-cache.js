export function retainPreviewEntries(entries, asset, limit = 2) {
  if (!asset?.previewUrl) return entries;
  const entry = entries.find(item => item.url === asset.previewUrl)
    || { url: asset.previewUrl, title: `${asset.title}三维检视`, status: 'loading', revision: 0 };
  return [...entries.filter(item => item.url !== entry.url), entry].slice(-limit);
}

export function previewKind(asset) {
  if (!asset?.previewUrl) return undefined;
  if (asset.previewUrl.includes('zifeng')) return 'zifeng';
  if (asset.previewUrl.includes('preview-gates')) return 'gates';
  return 'landmark';
}

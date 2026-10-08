import { CITY_SCHEMA } from './plan.js';

export const REQUIRED_BASE_FILES = ['js/geo.js', 'js/data.js', 'js/lib.js', 'js/world.js', 'js/water-mask.js',
  'js/whu-layout.js', 'js/road-layout.js', 'data/osm/roads.json', 'data/osm/roads-land.json',
  'data/wikidata-coords.json', 'docs/ATTRIBUTION.md', 'README.md', 'ATTRIBUTION.md',
  'vendor/three.module.js', 'vendor/three.core.js', 'vendor/OrbitControls.js', 'vendor/THREE-LICENSE.md'];

export async function hashBytes(bytes) {
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(value => value.toString(16).padStart(2, '0')).join('');
}

export async function verifySnapshot(manifest, readBytes) {
  if (manifest?.schema !== CITY_SCHEMA || !manifest.files || Array.isArray(manifest.files)
    || !/^[a-f0-9]{64}$/.test(manifest.baseVersion ?? '')) throw new Error('底图快照信息无效');
  const names = Object.keys(manifest.files);
  if (names.length !== REQUIRED_BASE_FILES.length || REQUIRED_BASE_FILES.some(name => !names.includes(name))) throw new Error('底图文件清单不完整或包含未允许文件');
  for (const name of names) {
    const record = manifest.files[name];
    if (!record || !Number.isSafeInteger(record.bytes) || record.bytes < 1 || record.bytes > 10 * 1024 * 1024
      || !/^[a-f0-9]{64}$/.test(record.sha256 ?? '')) throw new Error('底图文件指纹无效');
  }
  const computed = await hashBytes(new TextEncoder().encode(JSON.stringify(manifest.files)));
  if (computed !== manifest.baseVersion) throw new Error('底图版本与文件清单不一致');
  const loaded = new Map();
  await Promise.all(names.map(async name => {
    const bytes = await readBytes(name);
    if (!(bytes instanceof Uint8Array) || bytes.length !== manifest.files[name].bytes
      || await hashBytes(bytes) !== manifest.files[name].sha256) throw new Error(`底图文件指纹不一致：${name}`);
    loaded.set(name, bytes);
  }));
  return loaded;
}

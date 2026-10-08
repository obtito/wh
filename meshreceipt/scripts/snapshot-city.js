// Mechanical, read-only source extraction. Never resets, edits or pulls the source repository.
import { readFile, realpath, lstat, mkdir, mkdtemp, writeFile, rename } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { CITY_SCHEMA, validateRoads } from '../public/city/plan.js';

const project = fileURLToPath(new URL('../', import.meta.url));
const execute = promisify(execFile);
export const CITY_FILES = Object.freeze(['js/geo.js', 'js/data.js', 'js/lib.js', 'js/world.js',
  'js/water-mask.js', 'js/whu-layout.js', 'js/road-layout.js', 'data/osm/roads.json',
  'data/osm/roads-land.json', 'data/wikidata-coords.json', 'docs/ATTRIBUTION.md', 'README.md']);
export const digest = value => createHash('sha256').update(value).digest('hex');

async function boundedRead(root, relative) {
  const file = path.join(root, relative), resolved = await realpath(file);
  if (!resolved.startsWith(`${root}${path.sep}`) || !(await lstat(file)).isFile()) throw new Error(`Invalid source: ${relative}`);
  const bytes = await readFile(resolved);
  if (bytes.length > 10 * 1024 * 1024) throw new Error(`Oversized source: ${relative}`);
  return bytes;
}

export async function freezeCity({ source, destination = path.join(project, 'public/city/snapshot'), vendorRoot = path.join(project, 'node_modules/three') }) {
  if (!source || !path.isAbsolute(source)) throw new Error('An explicit absolute GTA-WH source directory is required');
  const root = await realpath(source), vendor = await realpath(vendorRoot);
  const output = path.resolve(destination);
  // Only a new directory may be created. Existing versions are deliberately not overwritten.
  try { await lstat(output); throw new Error('Snapshot already exists; preserve/archive it before creating a new version'); }
  catch (error) { if (error.code !== 'ENOENT') throw error; }
  const originals = new Map();
  for (const name of CITY_FILES) originals.set(name, await boundedRead(root, name));
  const originalRoads = validateRoads(JSON.parse(originals.get('data/osm/roads.json')));
  const scenePlan = JSON.parse(originals.get('data/osm/roads-land.json'));
  const sceneRoads = validateRoads(scenePlan);
  const locations = JSON.parse(originals.get('data/wikidata-coords.json'));
  if (!Array.isArray(locations.landmarks) || locations.crs !== 'WGS84 (EPSG:4326)') throw new Error('Unsupported coordinate collection');
  const records = new Map(originals);
  records.set('ATTRIBUTION.md', originals.get('docs/ATTRIBUTION.md'));
  for (const [target, name] of [['vendor/three.module.js', 'build/three.module.js'],
    ['vendor/three.core.js', 'build/three.core.js'], ['vendor/OrbitControls.js', 'examples/jsm/controls/OrbitControls.js'],
    ['vendor/THREE-LICENSE.md', 'LICENSE']]) records.set(target, await boundedRead(vendor, name));
  const files = Object.fromEntries([...records].sort(([a], [b]) => a.localeCompare(b, 'en'))
    .map(([name, bytes]) => [name, { bytes: bytes.length, sha256: digest(bytes) }]));
  const baseVersion = digest(JSON.stringify(files));
  let commit = null, dirty = null;
  try {
    commit = (await execute('git', ['rev-parse', 'HEAD'], { cwd: root })).stdout.trim();
    dirty = Boolean((await execute('git', ['status', '--porcelain', '--untracked-files=no'], { cwd: root })).stdout.trim());
  } catch { /* File hashes, not Git availability, define the snapshot. */ }
  const threePackage = JSON.parse(await boundedRead(vendor, 'package.json'));
  const manifest = { schema: CITY_SCHEMA, baseVersion, capturedAt: new Date().toISOString(), files,
    source: { kind: 'local-worktree', directory: root, repository: 'obtito/GTA-WH', commit, dirty,
      note: 'Selected files include local uncommitted changes; source files were not modified.' },
    rendering: { threeVersion: threePackage.version, metersPerUnit: 1, eastAxis: '+X', northAxis: '-Z',
      terrain: 'procedural reference, not satellite-derived elevation', coordinates: 'GTA-WH scene reference; selected points require review' },
    counts: { originalRoadRecords: originalRoads.length, sceneRoadRecords: sceneRoads.length,
      sourceEntities: locations.landmarks.length, sourceFeaturedEntities: locations.featured_count },
    roadAdjustments: scenePlan.stats ?? null,
    boundaries: { buildingsIncluded: false, modelAssetsIncluded: false, satellitePrecisionClaimed: false,
      communitySubmissionEnabled: false, onChainContributions: false, publicReleaseAuthorized: false },
    attribution: { OSM: '© OpenStreetMap contributors · ODbL 1.0; preserve data attribution and applicable obligations',
      sourceNotice: './ATTRIBUTION.md', threeLicense: './vendor/THREE-LICENSE.md',
      applicationCode: 'Project and upstream code distribution terms require separate confirmation; local prototype only.' },
  };
  const parent = path.dirname(output); await mkdir(parent, { recursive: true });
  const staging = await mkdtemp(path.join(parent, '.snapshot-stage-'));
  for (const [name, bytes] of records) {
    const target = path.join(staging, name); await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
  }
  for (const [name, bytes] of originals) {
    if (digest(await boundedRead(root, name)) !== digest(bytes)) throw new Error(`Source changed during snapshot: ${name}; staged files retained, not activated`);
  }
  await writeFile(path.join(staging, 'snapshot.json'), `${JSON.stringify(manifest, null, 2)}\n`, { flag: 'wx' });
  await rename(staging, output);
  return { output, baseVersion, files: records.size, source: manifest.source, counts: manifest.counts };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const args = process.argv.slice(2);
  if (args.length !== 2 || args[0] !== '--source') throw new Error('Usage: node scripts/snapshot-city.js --source /absolute/path/to/gta-wh');
  console.log(JSON.stringify(await freezeCity({ source: args[1] }), null, 2));
}

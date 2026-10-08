// OSM 真实城市数据抓取:分块拉建筑轮廓 + 主次干道(Overpass, ODbL)
// 用法: node tools/fetch_osm.mjs            → data/osm/buildings.json + roads.json
//       node tools/fetch_osm.mjs roads       → 只拉路网
import { writeFileSync, mkdirSync, existsSync, readFileSync } from 'node:fs';

const EP = 'https://overpass-api.de/api/interpreter';
const OUT = 'data/osm';
mkdirSync(OUT, { recursive: true });

// 核心区网格:两江四岸(30.50–30.64 N, 114.22–114.42 E)
const LAT0 = 30.500, LAT1 = 30.640, LON0 = 114.220, LON1 = 114.420;
const STEP_LAT = 0.035, STEP_LON = 0.040;

function cells() {
  const out = [];
  for (let lat = LAT0; lat < LAT1 - 1e-9; lat += STEP_LAT) {
    for (let lon = LON0; lon < LON1 - 1e-9; lon += STEP_LON) {
      out.push([lat, lon, Math.min(lat + STEP_LAT, LAT1), Math.min(lon + STEP_LON, LON1)]);
    }
  }
  return out;
}

async function q(query, tries = 4) {
  for (let t = 1; t <= tries; t++) {
    try {
      const res = await fetch(EP, {
        method: 'POST',
        headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': 'GTA-WH/0.3 city-builder' },
        body: 'data=' + encodeURIComponent(query),
      });
      if (res.status === 429 || res.status === 504) throw new Error('rate ' + res.status);
      if (!res.ok) throw new Error('http ' + res.status);
      return await res.json();
    } catch (e) {
      console.log(`  重试 ${t}/${tries}(${e.message}),等 ${t * 12}s…`);
      await new Promise((r) => setTimeout(r, t * 12000));
    }
  }
  return null;
}

function simplify(el) {
  // 精简:5 位小数(±1m),只留关键 tags
  const tags = {};
  const keep = ['building', 'height', 'building:levels', 'levels', 'name', 'highway', 'lanes', 'bridge', 'tunnel', 'width', 'railway'];
  for (const k of keep) if (el.tags?.[k] != null) tags[k] = el.tags[k];
  const geom = (el.geometry || []).map((g) => [Math.round(g.lon * 1e5) / 1e5, Math.round(g.lat * 1e5) / 1e5]);
  return { t: tags, g: geom };
}

async function fetchLayer(layer, filter, outfile) {
  if (existsSync(outfile)) {
    console.log(`${outfile} 已存在,跳过`);
    return JSON.parse(readFileSync(outfile, 'utf8'));
  }
  const all = [];
  const cs = cells();
  for (let i = 0; i < cs.length; i++) {
    const [s, w, n, e] = cs[i];
    const query = `[out:json][timeout:90];way[${filter}](${s},${w},${n},${e});out geom;`;
    process.stdout.write(`块 ${i + 1}/${cs.length} [${s.toFixed(3)},${w.toFixed(3)}] … `);
    const d = await q(query);
    if (!d) { console.log('失败,跳过'); continue; }
    const els = (d.elements || []).map(simplify).filter((x) => x.g.length >= 4);
    all.push(...els);
    console.log(`${els.length} 条(累计 ${all.length})`);
    writeFileSync(outfile + '.part', JSON.stringify(all));      // 断点保护
    await new Promise((r) => setTimeout(r, 2500));
  }
  // 去重(跨块重复)
  const seen = new Set();
  const dedup = all.filter((x) => {
    const k = x.g[0].join(',') + '|' + x.g[x.g.length - 1].join(',');
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
  writeFileSync(outfile, JSON.stringify(dedup));
  console.log(`✓ ${outfile}: ${dedup.length} 条`);
  return dedup;
}

const mode = process.argv[2] || 'all';
if (mode === 'roads' || mode === 'all') {
  await fetchLayer('roads', 'highway~"^(trunk|primary|secondary|tertiary|trunk_link|primary_link|secondary_link)$"', `${OUT}/roads.json`);
}
if (mode === 'buildings' || mode === 'all') {
  await fetchLayer('buildings', 'building', `${OUT}/buildings.json`);
}
console.log('完成');

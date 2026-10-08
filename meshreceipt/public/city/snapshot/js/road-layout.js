// Road widths and land corridors shared by the offline planner and scene builder.
import { toV2, toLonLat, resample, distToPolyline } from './geo.js';
import { BRIDGES } from './data.js';
import { footprintOverlapsWater } from './water-mask.js';

const WIDTHS = { motorway: 40, trunk: 34, trunk_link: 16, primary: 28, primary_link: 14, secondary: 22, secondary_link: 12, tertiary: 16, tertiary_link: 10 };
export function roadWidth(tags = {}) {
  const cap = WIDTHS[tags.highway];
  if (!cap) return null;
  const lanes = parseInt(tags.lanes, 10), explicit = parseFloat(tags.width);
  return Math.max(6, Math.min(cap, Number.isFinite(explicit) ? explicit : Number.isFinite(lanes) ? lanes * 3.25 + 2 : cap * 0.7));
}
export const isBridgeRoad = (tags = {}) => !!tags.bridge && tags.bridge !== 'no';
export const BRIDGE_WIDTHS = { truss: 22, cablestayed: 26, suspension3: 30, arch: 22 };
export const roadNodeFootprint = (p, radius) => Array.from({length: 8}, (_, i) => [p[0] + Math.cos(i * Math.PI / 4) * radius, p[1] + Math.sin(i * Math.PI / 4) * radius]);

const bridgeName = name => String(name || '').normalize('NFKC').replace(/\s+/g, '');
const LANDMARK_BRIDGE_ROADS = BRIDGES.map(bridge => {
  const axis = bridge.axis.map(ll => toV2(...ll));
  const length = Math.hypot(axis[1][0] - axis[0][0], axis[1][1] - axis[0][1]);
  // Photo-based landmark axes and OSM lanes can be hundreds of metres apart.
  // A bounded local corridor plus an exact name match avoids claiming nearby
  // independent bridges, distant namesakes, or generic elevated roads.
  return { id: bridge.id, name: bridgeName(bridge.name), axis, radius: Math.min(750, Math.max(120, length * .4)) };
});

/** Identity and local extent only; callers must also require an actual wet cell. */
export function modeledBridgeRoadAt(tags = {}, x, z) {
  if (!isBridgeRoad(tags)) return null;
  const names = [tags.name, tags['name:zh']].flatMap(name => String(name || '').split(/[;；]/).map(bridgeName));
  for (const bridge of LANDMARK_BRIDGE_ROADS) {
    if (names.includes(bridge.name) && distToPolyline(x, z, bridge.axis) <= bridge.radius) return bridge.id;
  }
  return null;
}

// Some simplified bridge axes end in the rendered river. Extend those ramps to a dry landing.
export function bridgeLanding(br, side) {
  const a = toV2(...br.axis[side]), b = toV2(...br.axis[1 - side]);
  const radius = BRIDGE_WIDTHS[br.kind] / 2 + 4;
  if (!footprintOverlapsWater(roadNodeFootprint(a, radius))) return null;
  const len = Math.hypot(a[0] - b[0], a[1] - b[1]), dx = (a[0] - b[0]) / len, dz = (a[1] - b[1]) / len;
  for (let shore = 8; shore <= 1200; shore += 8) {
    const at = distance => [a[0] + dx * distance, a[1] + dz * distance];
    if (footprintOverlapsWater(roadNodeFootprint(at(shore), radius))) continue;
    const distance = shore + 140, end = at(distance);
    if (!footprintOverlapsWater(roadNodeFootprint(end, radius))) return { start: a, end, shore, distance };
  }
  return null;
}

export function roadFootprint(a, b, width, margin = 0) {
  const dx = b[0] - a[0], dz = b[1] - a[1], len = Math.hypot(dx, dz) || 1;
  const nx = -dz / len * (width / 2 + margin), nz = dx / len * (width / 2 + margin);
  return [[a[0] + nx, a[1] + nz], [a[0] - nx, a[1] - nz], [b[0] - nx, b[1] - nz], [b[0] + nx, b[1] + nz]];
}

// Baked at development time: A* keeps shifted coastal roads on land, away from buildings.
// The runtime also rejects wet road triangles, so a changed water mask cannot expose an old wet route.
export function planLandRoads(roads, blocked = () => false) {
  const step = 20, maxShift = 1000, dirs = [[1,0],[-1,0],[0,1],[0,-1],[1,1],[-1,1],[1,-1],[-1,-1]];
  const key = p => p.map(v => Math.round(v * 100)).join(',');
  const nodeWidths = new Map(), snaps = new Map(), occupancy = new Map();
  const stats = { inputRoads: roads.length, reroutedRoads: 0, disconnectedSpans: 0 };
  for (const r of roads) {
    const w = roadWidth(r.t);
    if (w == null || isBridgeRoad(r.t)) continue;
    for (const ll of r.g) { const k = key(toV2(...ll)); nodeWidths.set(k, Math.max(w, nodeWidths.get(k) || 0)); }
  }
  const disk = roadNodeFootprint;
  const dryPoint = (p, w) => !footprintOverlapsWater(disk(p, w * 0.82 + 3));
  const safePoint = (x, z, w) => {
    const k = `${x},${z},${w}`, hit = occupancy.get(k);
    if (hit !== undefined) return hit;
    const poly = disk([x * step, z * step], w * 0.82 + 3);
    const safe = !footprintOverlapsWater(poly) && !blocked(poly);
    occupancy.set(k, safe); return safe;
  };
  const safeSegment = (a, b, w) => {
    const poly = roadFootprint(a, b, w * 1.5, 3);
    return !footprintOverlapsWater(poly) && !blocked(poly);
  };
  function snap(p, w, preferred = p, shared = false) {
    if (dryPoint(p, w)) return p;
    const k = key(p);
    if (shared && snaps.has(k)) return snaps.get(k);
    const gx = Math.round(p[0] / step), gz = Math.round(p[1] / step);
    let best = null, bestCost = Infinity;
    for (let ring = 0; ring <= maxShift / step; ring++) {
      for (let dx = -ring; dx <= ring; dx++) for (let dz = -ring; dz <= ring; dz++) {
        if (Math.max(Math.abs(dx), Math.abs(dz)) !== ring) continue;
        const x = gx + dx, z = gz + dz;
        if (!safePoint(x, z, w)) continue;
        const q = [x * step, z * step];
        const distance = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (distance > maxShift) continue;
        const cost = distance + (shared ? 0 : 0.4 * Math.hypot(q[0] - preferred[0], q[1] - preferred[1]));
        if (cost < bestCost) { best = q; bestCost = cost; }
      }
      if (best && ring * step > bestCost + step * 2) break;
    }
    if (shared) snaps.set(k, best);
    return best;
  }
  function path(a, b, w) {
    if (safeSegment(a, b, w)) return [a, b];
    const start = [Math.round(a[0] / step), Math.round(a[1] / step)];
    const end = [Math.round(b[0] / step), Math.round(b[1] / step)];
    // Exact junctions are retained. Find nearby grid portals connected by a dry full-width strip.
    function portal(p, g) {
      let best = null, distance = Infinity;
      for (let dx = -3; dx <= 3; dx++) for (let dz = -3; dz <= 3; dz++) {
        const x = g[0] + dx, z = g[1] + dz, q = [x * step, z * step];
        const d = Math.hypot(q[0] - p[0], q[1] - p[1]);
        if (d < distance && safePoint(x, z, w) && safeSegment(p, q, w)) { best = [x, z]; distance = d; }
      }
      return best;
    }
    const s = portal(a, start), e = portal(b, end);
    if (!s || !e) return null;
    const id = (x, z) => x + ',' + z, endId = id(...e);
    const minX = Math.min(s[0], e[0]) - 30, maxX = Math.max(s[0], e[0]) + 30;
    const minZ = Math.min(s[1], e[1]) - 30, maxZ = Math.max(s[1], e[1]) + 30;
    const heap = [], scores = new Map([[id(...s), 0]]), parents = new Map();
    function push(n) {
      heap.push(n); let i = heap.length - 1;
      while (i) { const p = (i - 1) >> 1; if (heap[p].f <= n.f) break; heap[i] = heap[p]; i = p; } heap[i] = n;
    }
    function pop() {
      const first = heap[0], last = heap.pop();
      if (heap.length) { let i = 0; while (i * 2 + 1 < heap.length) { let j = i * 2 + 1; if (j + 1 < heap.length && heap[j + 1].f < heap[j].f) j++; if (last.f <= heap[j].f) break; heap[i] = heap[j]; i = j; } heap[i] = last; }
      return first;
    }
    push({ x: s[0], z: s[1], g: 0, f: Math.hypot(e[0] - s[0], e[1] - s[1]) });
    let visited = 0;
    while (heap.length && visited++ < 18000) {
      const n = pop(), k = id(n.x, n.z);
      if (n.g !== scores.get(k)) continue;
      if (k === endId) {
        const out = [b, [e[0] * step, e[1] * step]];
        let current = k;
        while (parents.has(current)) { current = parents.get(current); out.push(current.split(',').map(Number).map(v => v * step)); }
        out.push(a); out.reverse();
        // Line-of-sight simplification removes grid stair steps while checking the full road corridor.
        const simple = [out[0]];
        for (let i = 0; i < out.length - 1;) {
          let j = out.length - 1;
          while (j > i + 1 && !safeSegment(out[i], out[j], w)) j--;
          simple.push(out[j]); i = j;
        }
        return simple;
      }
      for (const [dx, dz] of dirs) {
        const x = n.x + dx, z = n.z + dz;
        if (x < minX || x > maxX || z < minZ || z > maxZ || !safePoint(x, z, w)) continue;
        if (!safeSegment([n.x * step, n.z * step], [x * step, z * step], w)) continue;
        const next = id(x, z), g = n.g + Math.hypot(dx, dz);
        if (g >= (scores.get(next) ?? Infinity)) continue;
        scores.set(next, g); parents.set(next, k);
        push({x, z, g, f: g + Math.hypot(e[0] - x, e[1] - z)});
      }
    }
    return null;
  }
  const planned = [];
  for (const r of roads) {
    const w = roadWidth(r.t);
    if (w == null || isBridgeRoad(r.t) || (r.t?.tunnel && r.t.tunnel !== 'no')) { planned.push(r); continue; }
    const raw = r.g.map(ll => toV2(...ll));
    if (raw.every(p => dryPoint(p, nodeWidths.get(key(p)) || w)) && raw.slice(1).every((p, i) => !footprintOverlapsWater(roadFootprint(raw[i], p, w, 2)))) { planned.push(r); continue; }
    stats.reroutedRoads++;
    const pts = resample(raw, 40);
    let run = [], previous = null;
    const finish = () => {
      if (run.length > 1) planned.push({ ...r, g: run.map(p => toLonLat(...p).map(v => +v.toFixed(8))), planned: true });
      run = [];
    };
    for (const p of pts) {
      const junction = nodeWidths.has(key(p));
      const q = snap(p, junction ? nodeWidths.get(key(p)) : w, previous || p, junction);
      if (!q) { finish(); previous = null; continue; }
      if (!previous) run.push(q);
      else {
        const connection = path(previous, q, w);
        if (connection) run.push(...connection.slice(1));
        else { stats.disconnectedSpans++; finish(); run.push(q); }
      }
      previous = q;
    }
    finish();
  }
  stats.outputRoads = planned.length;
  return { roads: planned, stats, route: path };
}

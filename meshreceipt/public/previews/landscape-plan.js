// Exhibition landscaping, not surveyed geography. All lengths use the source
// model's normalized display units. Keep paths/planting outside its footprint.
export function seededRandom(seed) {
  let value = 2166136261;
  for (const char of String(seed)) value = Math.imul(value ^ char.charCodeAt(0), 16777619);
  return () => { value = Math.imul(value, 1664525) + 1013904223 | 0; return (value >>> 0) / 4294967296; };
}

export function landscapePlan(bounds, style, seed) {
  if (!['heritage', 'modern'].includes(style)) throw new Error('Unknown landscape style');
  const { minX, maxX, minZ, maxZ } = bounds;
  if (![minX, maxX, minZ, maxZ].every(Number.isFinite) || maxX <= minX || maxZ <= minZ
    || maxX - minX > 3000 || maxZ - minZ > 3000) throw new Error('Invalid landscape footprint');
  const heritage = style === 'heritage', random = seededRandom(seed);
  const width = maxX - minX, depth = maxZ - minZ;
  const side = heritage ? 35 : 25, rear = heritage ? 36 : 24, front = heritage ? 44 : 42;
  const plot = { minX: minX - side, maxX: maxX + side, minZ: minZ - rear, maxZ: maxZ + front };
  const axisX = (minX + maxX) / 2;
  const court = { x: axisX, z: maxZ + (heritage ? 12 : 10), width: heritage ? width * 0.7 : width * 0.8, depth: heritage ? 26 : 21 };
  const path = { x: axisX, z: maxZ + 31, width: heritage ? 10 : 8, depth: heritage ? 28 : 22 };
  const exclusion = { minX: minX - 5, maxX: maxX + 5, minZ: minZ - 5, maxZ: maxZ + 5 };
  const trees = [], rocks = [];
  const inside = (x, z, rectangle, padding = 0) => x > rectangle.minX - padding && x < rectangle.maxX + padding
    && z > rectangle.minZ - padding && z < rectangle.maxZ + padding;
  const inAxis = (x, z) => z > maxZ - 2 && Math.abs(x - axisX) < court.width / 2 + 5;
  const desired = heritage ? 78 : Math.min(70, Math.ceil((width + depth) / 9));
  for (let i = 0; i < desired * 25 && trees.length < desired; i++) {
    const x = plot.minX + 5 + random() * (plot.maxX - plot.minX - 10);
    const z = plot.minZ + 5 + random() * (plot.maxZ - plot.minZ - 10);
    if (inside(x, z, exclusion) || inAxis(x, z) || (!heritage && z > maxZ + 24)) continue;
    if (trees.some(tree => Math.hypot(tree.x - x, tree.z - z) < (heritage ? 6 : 7))) continue;
    const height = heritage ? 8 + random() * 7 : 7 + random() * 4;
    trees.push({ x, z, height, radius: height * (heritage ? 0.19 : 0.3), rotation: random() * Math.PI * 2,
      species: heritage ? (random() < 0.55 ? 'pine' : 'cypress') : 'canopy' });
  }
  if (heritage) for (let i = 0; i < 18; i++) {
    const x = (i % 2 ? 1 : -1) * (width / 2 + 13 + random() * 14) + axisX;
    const z = minZ + random() * (depth + 24);
    rocks.push({ x, z, size: 0.8 + random() * 1.8, rotation: random() * Math.PI });
  }
  const focus = { minX: minX - 15, maxX: maxX + 15, minZ: minZ - 16, maxZ: maxZ + (heritage ? 32 : 30) };
  return { style, seed, footprint: { minX, maxX, minZ, maxZ }, plot, focus, court, path, trees, rocks, exclusion };
}

// The exported four-vertex ground is not the building. Only classify large,
// near-zero-height surfaces, never roofs, podiums, or small authored details.
export function isExhibitionBase(surface, footprint) {
  const width = surface.maxX - surface.minX, depth = surface.maxZ - surface.minZ;
  return Object.values(surface).every(Number.isFinite) && width > 0 && depth > 0
    && surface.maxY - surface.minY < 0.05 && Math.abs(surface.maxY) < 0.1
    && width * depth > (footprint.maxX - footprint.minX) * (footprint.maxZ - footprint.minZ) * 0.75;
}

export function modernGardenBeds(footprint, occupied) {
  const b = footprint, o = occupied, beds = [];
  if (!o || ![o.minX, o.maxX, o.minZ, o.maxZ].every(Number.isFinite)
    || o.maxX <= o.minX || o.maxZ <= o.minZ
    || o.minX < b.minX || o.maxX > b.maxX || o.minZ < b.minZ || o.maxZ > b.maxZ) return beds;
  const add = (minX, maxX, minZ, maxZ, maxWidth, maxDepth) => {
    if (maxX - minX < 12 || maxZ - minZ < 12) return;
    const x = (minX + maxX) / 2, z = (minZ + maxZ) / 2;
    beds.push({ x, z, width: Math.min(maxWidth, (maxX - minX) * 0.8), depth: Math.min(maxDepth, (maxZ - minZ) * 0.86) });
  };
  add(b.minX + 7, o.minX - 10, b.minZ + 10, b.maxZ - 10, 42, 1000);
  add(o.maxX + 10, b.maxX - 7, b.minZ + 10, b.maxZ - 10, 42, 1000);
  add(o.minX, o.maxX, b.minZ + 7, o.minZ - 10, 1000, 30);
  return beds;
}

export function terrainHeight(x, z, plan) {
  if (plan.style !== 'heritage') return -0.3;
  const b = plan.footprint;
  if (z >= b.maxZ - 2 && z <= plan.plot.maxZ + 12 && Math.abs(x - plan.court.x) <= plan.court.width / 2 + 3) return -0.3;
  const dx = Math.max(b.minX - x, 0, x - b.maxX), dz = Math.max(b.minZ - z, 0, z - b.maxZ);
  const edgeDistance = Math.hypot(dx, dz);
  const transition = Math.min(1, edgeDistance / 20);
  const t = transition * transition * (3 - 2 * transition);
  // Flat around the authored steps, gently rising behind and to either side.
  const rearSlope = Math.min(5, Math.max(0, b.minZ + 8 - z) * 0.14);
  const hill = 0.7 + rearSlope + 0.65 * Math.sin(x * 0.06) + 0.45 * Math.cos(z * 0.07 + x * 0.03);
  return -0.3 + t * Math.max(0, hill);
}

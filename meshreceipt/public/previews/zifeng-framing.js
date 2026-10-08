// The cinematic cover looks at the south-west main facade: the annex stays
// left of the tower and the recessed vertical strip stays on its right.
export const ZIFENG_COVER_VIEW = Object.freeze({ angle: 2.35, pitch: -0.045 });

// Fit only the authored building, never the large presentation ground.
// Padding describes actual UI pixels; an off-axis view keeps the building
// centred in the unobstructed area instead of shrinking it around the toolbar.
export function zifengFrame({ size, width, height, angle = ZIFENG_COVER_VIEW.angle, pitch = ZIFENG_COVER_VIEW.pitch, fov = 38,
  top = 24, bottom = 80, side = 24, orbitSafe = false, envelope = null }) {
  if (![size.x, size.y, size.z, width, height, angle, pitch, fov, top, bottom, side].every(Number.isFinite)
    || [size.x, size.y, size.z, width, height].some(value => value <= 0)
    || fov <= 0 || fov >= 160 || Math.min(top, bottom, side) < 0
    || top + bottom >= height || side * 2 >= width
    || envelope !== null && (!envelope.length || envelope.some(point => ![point.x, point.y, point.z].every(Number.isFinite)))) {
    throw new Error('Invalid building framing dimensions');
  }
  const norm = Math.hypot(1, pitch);
  const direction = { x: Math.cos(angle) / norm, y: pitch / norm, z: Math.sin(angle) / norm };
  const right = { x: Math.sin(angle), y: 0, z: -Math.cos(angle) };
  const up = { x: -pitch * Math.cos(angle) / norm, y: 1 / norm, z: -pitch * Math.sin(angle) / norm };
  const tanY = Math.tan(fov * Math.PI / 360), tanX = tanY * width / height;
  const fractionX = (width - side * 2) / width, fractionY = (height - top - bottom) / height;
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  const points = envelope || [-1, 1].flatMap(x => [-1, 1].flatMap(y => [-1, 1].map(z => ({
    x: x * size.x / 2, y: y * size.y / 2, z: z * size.z / 2,
  }))));
  let distance = 0;
  for (const point of points) {
    const depth = dot(point, direction);
    distance = Math.max(distance, depth + Math.abs(dot(point, right)) / (tanX * fractionX),
      depth + Math.abs(dot(point, up)) / (tanY * fractionY));
  }
  if (orbitSafe) {
    const radius = Math.hypot(size.x, size.z) / 2, halfHeight = size.y / 2;
    const depth = (radius + Math.abs(pitch) * halfHeight) / norm;
    distance = Math.max(distance, depth + radius / (tanX * fractionX),
      depth + (halfHeight + Math.abs(pitch) * radius) / (norm * tanY * fractionY));
  }
  let offsetX = 0, offsetY = (bottom - top) / 2;
  if (envelope && !orbitSafe) {
    const projected = points.map(point => ({ depth: dot(point, direction), x: dot(point, right) / tanX, y: dot(point, up) / tanY }));
    function extents(atDistance) {
      let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
      for (const point of projected) {
        const depth = atDistance - point.depth;
        const x = point.x / depth, y = point.y / depth;
        minX = Math.min(minX, x); maxX = Math.max(maxX, x);
        minY = Math.min(minY, y); maxY = Math.max(maxY, y);
      }
      return { minX, maxX, minY, maxY };
    }
    // A stepped tower is not vertically symmetric about the centre of its
    // ground footprint. Fit the projected silhouette, then centre that actual
    // silhouette in the free area instead of losing space above the spire.
    let near = Math.max(2, ...projected.map(point => point.depth + 0.01)), far = Math.max(near, distance);
    for (let i = 0; i < 24; i++) {
      const middle = (near + far) / 2, box = extents(middle);
      if (box.maxX - box.minX <= fractionX * 2 && box.maxY - box.minY <= fractionY * 2) far = middle;
      else near = middle;
    }
    distance = far;
    const box = extents(distance * 1.025);
    offsetX = width * (box.maxX + box.minX) / 4;
    offsetY -= height * (box.maxY + box.minY) / 4;
  }
  return { distance: Math.max(2, distance * 1.025), direction, right, up,
    offsetX, offsetY, top, bottom, side };
}

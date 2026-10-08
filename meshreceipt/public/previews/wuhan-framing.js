// Camera composition follows each cover's architecture, excluding the much
// larger presentation garden. Pixel padding keeps the model clear of controls.
export function wuhanCoverFrame({ size, width, height, asset, angle = 'cover', fov = 38 }) {
  if (![size.x, size.y, size.z, width, height, fov].every(Number.isFinite)
    || [size.x, size.y, size.z, width, height].some(value => value <= 0)
    || fov <= 0 || fov >= 160 || !['huanghe', 'wuhan-landmarks'].includes(asset)
    || !['cover', 'front', 'top'].includes(angle)) throw new Error('Invalid Wuhan framing dimensions');
  const yellow = asset === 'huanghe';
  // Huanghe's plaque faces -Z. The cover shows its front with the side face on
  // the right; the skyline keeps the five towers almost in a frontal row.
  const vector = angle === 'top' ? [0.001, 1, 0.001]
    : angle === 'front' ? [0, 0.04, yellow ? -1 : 1]
      : yellow ? [-0.28, -0.08, -1] : [0.08, -0.03, 1];
  const length = Math.hypot(...vector);
  const direction = { x: vector[0] / length, y: vector[1] / length, z: vector[2] / length };
  const horizontal = Math.hypot(direction.x, direction.z);
  const right = { x: direction.z / horizontal, y: 0, z: -direction.x / horizontal };
  const up = { x: direction.y * right.z, y: direction.z * right.x - direction.x * right.z, z: -direction.y * right.x };
  const side = Math.min(18, width * 0.06), top = Math.min(54, height * 0.14), bottom = Math.min(84, height * 0.2);
  // Preserve the cover's slightly right-of-centre Huanghe composition on wide
  // screens. On phones, use the full width to keep the complete tower visible.
  const offsetX = yellow && angle === 'cover' && width > 520 ? -width * 0.07 : 0;
  const offsetY = (bottom - top) / 2;
  const fractionX = (width - side * 2 - Math.abs(offsetX) * 2) / width;
  const fractionY = (height - top - bottom) / height;
  const tanY = Math.tan(fov * Math.PI / 360), tanX = tanY * width / height;
  const dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
  let distance = 0;
  for (const x of [-size.x / 2, size.x / 2]) for (const y of [-size.y / 2, size.y / 2]) for (const z of [-size.z / 2, size.z / 2]) {
    const point = { x, y, z }, depth = dot(point, direction);
    distance = Math.max(distance, depth + Math.abs(dot(point, right)) / (tanX * fractionX),
      depth + Math.abs(dot(point, up)) / (tanY * fractionY));
  }
  return { distance: distance * 1.025, direction, right, up, offsetX, offsetY, side, top, bottom };
}

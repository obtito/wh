// The cover looks north along the stairs toward the memorial hall. Fit the
// authored hall, not the long approach road or the surrounding terrain strip.
export function mausoleumCoverFrame({ min, max, width, height, fov = 40 }) {
  if (![...min, ...max, width, height, fov].every(Number.isFinite)
    || width <= 0 || height <= 0 || fov <= 0 || fov >= 150
    || min.some((value, i) => value >= max[i])) throw new Error('Invalid mausoleum framing dimensions');
  const target = min.map((value, i) => (value + max[i]) / 2);
  const pitch = -0.05, norm = Math.hypot(1, pitch);
  const direction = [0, pitch / norm, 1 / norm], up = [0, 1 / norm, -pitch / norm];
  const tanV = Math.tan(fov * Math.PI / 360), tanH = tanV * width / height;
  const top = Math.min(48, height * 0.15), bottom = Math.min(width < 360 ? 110 : 64, height * 0.3);
  const fractionY = Math.min(0.44, (height - top - bottom) / height * 0.94);
  const dot = (a, b) => a.reduce((sum, value, i) => sum + value * b[i], 0);
  let distance = 0;
  for (const x of [min[0], max[0]]) for (const y of [min[1], max[1]]) for (const z of [min[2], max[2]]) {
    const point = [x - target[0], y - target[1], z - target[2]];
    // Keep sky above and stairs below the hall, including the control strip.
    distance = Math.max(distance, dot(point, direction) + Math.abs(x - target[0]) / (tanH * 0.78),
      dot(point, direction) + Math.abs(dot(point, up)) / (tanV * fractionY));
  }
  distance *= 1.035;
  return { target, position: target.map((value, i) => value + direction[i] * distance), direction,
    offsetY: (bottom - top) / 2, top, bottom };
}

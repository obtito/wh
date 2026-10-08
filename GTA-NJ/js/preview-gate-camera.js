import * as THREE from 'three';

// The wall poster looks toward the outer facade from its left, close to ground
// level. Keep the existing gate geometry and fit this camera to its actual bounds.
export function gateCoverPose(bounds, { aspect = 1, fov = 35 } = {}) {
  const size = bounds.getSize(new THREE.Vector3());
  const center = bounds.getCenter(new THREE.Vector3());
  const height = Math.max(size.y, .12);
  const target = new THREE.Vector3(center.x, bounds.min.y + height * .62, center.z);
  const eyeY = bounds.min.y + height * .19;
  const horizontal = new THREE.Vector3(-.36, 0, 1).normalize();
  const camera = new THREE.PerspectiveCamera(fov, aspect, .002, 200);
  const corners = [];
  for (const x of [bounds.min.x, bounds.max.x])
    for (const y of [bounds.min.y, bounds.max.y])
      for (const z of [bounds.min.z, bounds.max.z]) corners.push(new THREE.Vector3(x, y, z));
  const position = new THREE.Vector3();
  const fits = distance => {
    position.copy(target).addScaledVector(horizontal, distance); position.y = eyeY;
    camera.position.copy(position); camera.lookAt(target); camera.updateMatrixWorld(true);
    return corners.every(corner => {
      const p = corner.clone().project(camera);
      // Leave the title and control rows clear, including in a narrow iframe.
      return p.z > -1 && p.z < 1 && Math.abs(p.x) <= .84 && p.y >= -.66 && p.y <= .47;
    });
  };
  // Keep the low camera in front of the gate and within the orbit elevation limit.
  let low = Math.max(size.z * .6, (target.y - eyeY) / Math.tan(Math.PI * .065), .2);
  let high = Math.max(size.length() * 2, low * 2);
  while (!fits(high)) high *= 1.5;
  for (let i = 0; i < 30; i++) {
    const distance = (low + high) / 2;
    if (fits(distance)) high = distance; else low = distance;
  }
  fits(high);
  return { position: position.clone(), target };
}

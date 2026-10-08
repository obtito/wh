import * as THREE from 'three';

// Exhibition transforms only; do not bake them into authored mesh data.
export function normalizePreviewModel(root, item) {
  if (item.rotationY) root.rotation.y += item.rotationY;
  const bounds = new THREE.Box3().setFromObject(root), height = bounds.max.y - bounds.min.y;
  if (bounds.isEmpty() || !Number.isFinite(height) || height <= 0) throw new Error('模型包围盒无效');
  const normalized = new THREE.Group(); normalized.add(root);
  if (!item.preserveScale) root.scale.multiplyScalar(item.displayHeight / height);
  root.updateMatrixWorld(true);
  const scaled = new THREE.Box3().setFromObject(root), center = scaled.getCenter(new THREE.Vector3());
  root.position.sub(new THREE.Vector3(center.x, scaled.min.y, center.z)); root.updateMatrixWorld(true);
  normalized.userData.displayWidth = scaled.max.x - scaled.min.x;
  normalized.userData.displayHeight = scaled.max.y - scaled.min.y;
  return normalized;
}

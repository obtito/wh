import * as THREE from 'three';

// Adapted from GTA-WH/js/main.js (2026-10-07 local snapshot). Apply only after
// normalizing the base building to 51.4 m. No geographic offset or 2 m sinking:
// our exhibition has a flat foundation rather than GTA-WH's Snake Hill terrain.
export function applyLatestPresentation(building, { maxAnisotropy = 8, createCanvas = () => document.createElement('canvas') } = {}) {
  building.updateMatrixWorld(true);
  const bounds = new THREE.Box3().setFromObject(building);
  if (bounds.isEmpty()) throw new Error('展示修订需要有效楼体');
  const center = bounds.getCenter(new THREE.Vector3());
  const revised = new Map();
  building.traverse(mesh => {
    if (!mesh.isMesh) return;
    const revise = source => {
      if (!source) return source;
      if (revised.has(source)) return revised.get(source);
      const material = source.clone(); revised.set(source, material);
      if (material.map) { material.map.anisotropy = Math.min(8, maxAnisotropy); material.map.needsUpdate = true; }
      if (material.name === 'Material #25') {
        material.color.set('#a87330'); material.metalness = 0; material.roughness = 0.78;
        material.vertexColors = false; material.emissive.set(0x000000);
        material.userData.nightGlowScale = 0; material.needsUpdate = true;
      } else if (material.name.endsWith('-008')) {
        material.color.set('#a74432'); material.roughness = 0.75;
      }
      return material;
    };
    mesh.material = Array.isArray(mesh.material) ? mesh.material.map(revise) : revise(mesh.material);
  });
  const additions = new THREE.Group(); additions.name = 'gta-wh-display-revision';
  additions.userData.presentation = 'gta-wh-20261007';
  const gold = new THREE.MeshStandardMaterial({ color: '#a87330', metalness: 0, roughness: 0.78 });
  const finial = new THREE.Group(); finial.name = 'gta-wh-gourd-finial';
  for (const [radius, y, segments] of [[1.35, 0.9, 18], [0.85, 2.4, 16]]) {
    const sphere = new THREE.Mesh(new THREE.SphereGeometry(radius, segments, radius > 1 ? 14 : 12), gold);
    sphere.position.y = y; finial.add(sphere);
  }
  const rod = new THREE.Mesh(new THREE.CylinderGeometry(0.1, 0.1, 1.6, 8), gold);
  rod.position.y = 3.5; finial.add(rod);
  finial.position.set(center.x, bounds.max.y - 0.7, center.z); additions.add(finial);

  const canvas = createCanvas(); canvas.width = 512; canvas.height = 144;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('无法绘制黄鹤楼匾额');
  context.fillStyle = '#14151c'; context.fillRect(0, 0, 512, 144);
  context.strokeStyle = '#c9a227'; context.lineWidth = 8; context.strokeRect(6, 6, 500, 132);
  context.fillStyle = '#e8c34a'; context.font = 'bold 104px KaiTi, STKaiti, serif';
  context.textAlign = 'center'; context.textBaseline = 'middle'; context.fillText('黄鹤楼', 256, 78);
  const texture = new THREE.CanvasTexture(canvas); texture.colorSpace = THREE.SRGBColorSpace;
  const plaque = new THREE.Mesh(new THREE.BoxGeometry(6, 1.7, 0.25),
    [gold, gold, gold, gold, new THREE.MeshStandardMaterial({ map: texture, roughness: 0.6 }), gold]);
  plaque.name = 'gta-wh-huanghe-plaque';
  plaque.position.set(center.x, bounds.min.y + 43.5, center.z - 9.6); plaque.rotation.y = Math.PI;
  additions.add(plaque);
  additions.traverse(mesh => { if (mesh.isMesh) mesh.castShadow = mesh.receiveShadow = true; });
  return additions;
}

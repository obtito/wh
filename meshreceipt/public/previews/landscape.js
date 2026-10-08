import * as THREE from 'three';
import { landscapePlan, terrainHeight, seededRandom, isExhibitionBase, modernGardenBeds } from './landscape-plan.js';

function texture(kind) {
  const canvas = document.createElement('canvas'); canvas.width = canvas.height = 512;
  const context = canvas.getContext('2d'), random = seededRandom(`surface-${kind}`);
  context.fillStyle = { grass: '#738266', stone: '#b4b5a9', heritage: '#aaa99b', asphalt: '#727775' }[kind];
  context.fillRect(0, 0, 512, 512);
  if (kind === 'stone' || kind === 'heritage') {
    const tileWidth = kind === 'heritage' ? 128 : 64, tileHeight = kind === 'heritage' ? 64 : 128;
    for (let y = -tileHeight; y < 512 + tileHeight; y += tileHeight) for (let x = -tileWidth; x < 512 + tileWidth; x += tileWidth) {
      const shade = (kind === 'heritage' ? 164 : 180) + Math.floor(random() * 18);
      context.fillStyle = `rgb(${shade},${shade + 1},${shade - 8})`;
      const shift = kind === 'heritage' && (y / tileHeight) % 2 ? tileWidth / 2 : 0;
      context.fillRect(x + shift + 1, y + 1, tileWidth - 2, tileHeight - 2);
    }
  }
  for (let i = 0; i < 24000; i++) {
    context.fillStyle = random() > 0.5 ? '#ffffff14' : '#18231812';
    const x = random() * 512, y = random() * 512;
    context.fillRect(x, y, kind === 'grass' ? 1 : 0.7, kind === 'grass' ? 1 + random() * 3 : 0.7);
  }
  const map = new THREE.CanvasTexture(canvas); map.wrapS = map.wrapT = THREE.RepeatWrapping;
  map.colorSpace = THREE.SRGBColorSpace; map.anisotropy = 4; return map;
}

export function createLandscapeKit(style) {
  const heritage = style === 'heritage';
  const grassMap = texture('grass'), pavingMap = texture(heritage ? 'heritage' : 'stone'), roadMap = texture('asphalt');
  const materials = {
    grass: new THREE.MeshStandardMaterial({ color: heritage ? '#aab48a' : '#b5bc9c', map: grassMap, roughness: 1, vertexColors: true }),
    lawn: new THREE.MeshStandardMaterial({ color: '#b5bc9c', map: grassMap, roughness: 1 }),
    paving: new THREE.MeshStandardMaterial({ color: heritage ? '#b0b4a8' : '#c9cfcc', map: pavingMap, bumpMap: pavingMap, bumpScale: 0.045, roughness: 0.94 }),
    road: new THREE.MeshStandardMaterial({ map: roadMap, roughness: 0.94 }),
    stone: new THREE.MeshStandardMaterial({ color: heritage ? '#8e9286' : '#bcbeb4', roughness: 0.95 }),
    curb: new THREE.MeshStandardMaterial({ color: '#c0c2b5', roughness: 0.88 }),
    trunk: new THREE.MeshStandardMaterial({ color: '#6b6450', roughness: 1 }),
    leaves: new THREE.MeshStandardMaterial({ color: '#526947', roughness: 1 }),
    shrub: new THREE.MeshStandardMaterial({ color: '#66764d', roughness: 1 }),
    wood: new THREE.MeshStandardMaterial({ color: '#817052', roughness: 0.9 }),
    metal: new THREE.MeshStandardMaterial({ color: '#45534e', metalness: 0.55, roughness: 0.6 }),
    marking: new THREE.MeshStandardMaterial({ color: '#e0dfcf', roughness: 1 }),
  };
  const unitBox = new THREE.BoxGeometry(1, 1, 1), foliage = new THREE.SphereGeometry(1, 12, 8);
  const leafPositions = foliage.attributes.position;
  for (let i = 0; i < leafPositions.count; i++) {
    const x = leafPositions.getX(i), y = leafPositions.getY(i), z = leafPositions.getZ(i);
    const variation = 1 + 0.16 * Math.sin(x * 8 + z * 7) * Math.cos(y * 6 - z * 4);
    leafPositions.setXYZ(i, x * variation, y * variation, z * variation);
  }
  foliage.computeVertexNormals();
  const trunk = new THREE.CylinderGeometry(0.7, 1, 1, 7);
  const rock = new THREE.IcosahedronGeometry(1, 1), matrix = new THREE.Matrix4(), rotation = new THREE.Quaternion(), up = new THREE.Vector3(0, 1, 0);
  function instances(parent, geometry, material, placements, shadow = true) {
    if (!placements.length) return;
    const mesh = new THREE.InstancedMesh(geometry, material, placements.length);
    const random = seededRandom(`${style}-${placements.length}-${material.color.getHex()}`), base = new THREE.Color(1, 1, 1);
    placements.forEach((p, i) => {
      rotation.setFromAxisAngle(up, p.rotation || 0);
      matrix.compose(new THREE.Vector3(p.x, p.y, p.z), rotation, new THREE.Vector3(p.sx, p.sy, p.sz)); mesh.setMatrixAt(i, matrix);
      if (material === materials.leaves || material === materials.shrub) mesh.setColorAt(i, base.clone().multiplyScalar(0.84 + random() * 0.26));
    });
    mesh.castShadow = shadow; mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function box(parent, material, x, y, z, width, height, depth) {
    const mesh = new THREE.Mesh(unitBox, material); mesh.position.set(x, y, z); mesh.scale.set(width, height, depth);
    mesh.receiveShadow = true; mesh.castShadow = height > 0.4; parent.add(mesh); return mesh;
  }
  function plane(parent, material, x, y, z, width, depth, tile = 8) {
    const geometry = new THREE.PlaneGeometry(width, depth).rotateX(-Math.PI / 2);
    const uv = geometry.attributes.uv;
    for (let i = 0; i < uv.count; i++) uv.setXY(i, uv.getX(i) * width / tile, uv.getY(i) * depth / tile);
    const mesh = new THREE.Mesh(geometry, material); mesh.position.set(x, y, z); mesh.receiveShadow = true; parent.add(mesh); return mesh;
  }
  function terrain(parent, bounds, plan) {
    const width = bounds.maxX - bounds.minX, depth = bounds.maxZ - bounds.minZ;
    const cx = (bounds.minX + bounds.maxX) / 2, cz = (bounds.minZ + bounds.maxZ) / 2;
    const geometry = new THREE.PlaneGeometry(width, depth, heritage ? 128 : 12, heritage ? 128 : 12).rotateX(-Math.PI / 2);
    const positions = geometry.attributes.position, uv = geometry.attributes.uv, colors = [];
    for (let i = 0; i < positions.count; i++) {
      const tx = positions.getX(i) / (width / 2), tz = positions.getZ(i) / (depth / 2);
      const x = (heritage ? Math.sign(tx) * tx * tx * width / 2 : positions.getX(i)) + cx;
      const z = (heritage ? Math.sign(tz) * tz * tz * depth / 2 : positions.getZ(i)) + cz;
      positions.setXYZ(i, x, plan ? terrainHeight(x, z, plan) : -0.33, z);
      uv.setXY(i, x / 5, z / 5);
      const variation = 0.92 + 0.07 * Math.sin(x * 0.045) * Math.cos(z * 0.055);
      colors.push(variation, variation, variation * 0.96);
    }
    geometry.setAttribute('color', new THREE.Float32BufferAttribute(colors, 3)); geometry.computeVertexNormals();
    const ground = new THREE.Mesh(geometry, materials.grass); ground.receiveShadow = true; parent.add(ground); return ground;
  }
  function addTrees(parent, trees, plan) {
    const trunks = [], crowns = [], spires = [], random = seededRandom(`${plan.seed}-foliage`);
    for (const tree of trees) {
      const y = terrainHeight(tree.x, tree.z, plan), h = tree.height, r = tree.radius;
      trunks.push({ x: tree.x, y: y + h * 0.34, z: tree.z, sx: h * 0.025, sy: h * 0.68, sz: h * 0.025 });
      if (tree.species === 'cypress') {
        for (let i = 0; i < 4; i++) spires.push({ x: tree.x + Math.sin(i * 1.7) * r * 0.12, y: y + h * (0.4 + i * 0.13), z: tree.z + Math.cos(i * 2.1) * r * 0.12,
          sx: r * (0.82 - i * 0.15), sy: h * 0.22, sz: r * (0.82 - i * 0.15), rotation: tree.rotation });
      } else {
        for (let i = 0; i < (tree.species === 'pine' ? 5 : 6); i++) {
          const a = i / 5 * Math.PI * 2, offset = i ? r * 0.58 : 0;
          crowns.push({ x: tree.x + Math.cos(a) * offset, y: y + h * (0.62 + random() * 0.22), z: tree.z + Math.sin(a) * offset,
            sx: r * (0.65 + random() * 0.3), sy: r * (tree.species === 'pine' ? 0.38 : 0.75), sz: r * (0.65 + random() * 0.3), rotation: tree.rotation });
        }
      }
    }
    instances(parent, trunk, materials.trunk, trunks);
    instances(parent, foliage, materials.leaves, crowns);
    instances(parent, foliage, materials.leaves, spires);
  }
  function benches(parent, plan) {
    const count = heritage ? 4 : 6, extent = plan.court.width / 2;
    for (let i = 0; i < count; i++) {
      const x = plan.court.x + (i % 2 ? -1 : 1) * (extent + 2.8), z = plan.court.z - 7 + Math.floor(i / 2) * 7;
      box(parent, heritage ? materials.stone : materials.wood, x, 0.4, z, 2.5, 0.17, 0.72);
      box(parent, materials.stone, x - 0.8, 0.08, z, 0.2, 0.5, 0.52); box(parent, materials.stone, x + 0.8, 0.08, z, 0.2, 0.5, 0.52);
      if (!heritage) box(parent, materials.wood, x, 0.7, z - 0.32, 2.5, 0.5, 0.1);
    }
  }
  function modernDetails(parent, plan) {
    const b = plan.footprint, plot = plan.plot, streetZ = b.maxZ + 34;
    const roadWidth = plot.maxX - plot.minX;
    plane(parent, materials.road, plan.court.x, -0.18, streetZ, roadWidth, 12, 12);
    plane(parent, materials.paving, plan.court.x, -0.13, streetZ - 10, roadWidth, 7, 8);
    box(parent, materials.curb, plan.court.x, -0.08, streetZ - 6.6, roadWidth, 0.18, 0.3);
    box(parent, materials.curb, plan.court.x, -0.08, streetZ + 6.6, roadWidth, 0.18, 0.3);
    const markings = [];
    for (let x = plot.minX + 3; x < plot.maxX - 3; x += 10) markings.push({ x, y: -0.155, z: streetZ, sx: 4.5, sy: 0.015, sz: 0.14 });
    for (let z = streetZ - 5; z <= streetZ + 5; z += 1.1) markings.push({ x: plan.court.x, y: -0.15, z, sx: 5, sy: 0.015, sz: 0.55 });
    instances(parent, unitBox, materials.marking, markings, false);
    const shrubs = [], lights = [], caps = [];
    for (const side of [-1, 1]) {
      const x = side < 0 ? b.minX - 12 : b.maxX + 12;
      for (let z = b.minZ + 6; z < b.maxZ - 4; z += 4) shrubs.push({ x, y: 0.38, z, sx: 1.8, sy: 0.65, sz: 1.8 });
      for (let z = b.minZ + 12; z < b.maxZ; z += 30) {
        lights.push({ x, y: 2.5, z, sx: 0.12, sy: 5.6, sz: 0.12 });
        caps.push({ x, y: 5.3, z, sx: 1.3, sy: 0.1, sz: 0.6 });
      }
      box(parent, materials.curb, x, -0.08, (b.minZ + b.maxZ) / 2, 5, 0.18, b.maxZ - b.minZ);
    }
    instances(parent, foliage, materials.shrub, shrubs);
    instances(parent, unitBox, materials.metal, lights); instances(parent, unitBox, materials.metal, caps);
  }
  function heritageDetails(parent, plan) {
    const b = plan.footprint, center = plan.court.x;
    // Transition terraces sit below the existing stair foot; no new steps cover it.
    for (let i = 0; i < 3; i++) box(parent, materials.stone, center, -0.21 - i * 0.075, b.maxZ + 25 + i * 0.8,
      plan.path.width + 2, 0.14, 1.1);
    for (const side of [-1, 1]) {
      const x = center + side * (plan.court.width / 2 + 3);
      for (let z = b.maxZ + 3; z <= b.maxZ + 18; z += 7) {
        box(parent, materials.stone, x, 0.15, z, 1, 0.9, 1);
        box(parent, materials.stone, x, 0.9, z, 0.6, 0.7, 0.6);
        box(parent, materials.stone, x, 1.3, z, 1.2, 0.2, 1.2);
      }
    }
    const placements = plan.rocks.map(r => ({ x: r.x, y: terrainHeight(r.x, r.z, plan) + r.size * 0.3, z: r.z,
      sx: r.size * 1.4, sy: r.size * 0.7, sz: r.size, rotation: r.rotation }));
    instances(parent, rock, materials.stone, placements);
  }
  function dressBase(root, bounds) {
    if (heritage) return null;
    const occupied = new THREE.Box3(), point = new THREE.Vector3();
    root.updateMatrixWorld(true);
    root.traverse(mesh => {
      if (!mesh.isMesh) return;
      const area = new THREE.Box3().setFromObject(mesh);
      const surface = { minX: area.min.x, maxX: area.max.x, minY: area.min.y, maxY: area.max.y, minZ: area.min.z, maxZ: area.max.z };
      if (mesh.geometry.attributes.position.count !== 4 || !isExhibitionBase(surface, bounds)) { occupied.union(area); return; }
      // Change only a cloned preview geometry/material; keep the source binary.
      mesh.geometry = mesh.geometry.clone();
      const positions = mesh.geometry.attributes.position, uv = new Float32Array(positions.count * 2);
      for (let i = 0; i < positions.count; i++) {
        point.fromBufferAttribute(positions, i).applyMatrix4(mesh.matrixWorld); uv[i * 2] = point.x / 8; uv[i * 2 + 1] = point.z / 8;
      }
      mesh.geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
      const material = materials.paving.clone(); material.side = mesh.material.side; mesh.material = material;
      mesh.castShadow = false; mesh.receiveShadow = true;
    });
    return occupied.isEmpty() ? null : { minX: occupied.min.x, maxX: occupied.max.x, minZ: occupied.min.z, maxZ: occupied.max.z };
  }
  function innerGardens(parent, plan, occupied) {
    const beds = modernGardenBeds(plan.footprint, occupied), trees = [], random = seededRandom(`${plan.seed}-inner-beds`);
    for (const bed of beds) {
      // Raised a few centimetres above the existing zero-height export plane.
      plane(parent, materials.lawn, bed.x, 0.04, bed.z, bed.width, bed.depth, 5);
      for (const side of [-1, 1]) box(parent, materials.curb, bed.x + side * bed.width / 2, 0.05, bed.z, 0.3, 0.12, bed.depth);
      const columns = bed.width > 20 ? 2 : 1, rows = Math.max(1, Math.floor(bed.depth / 13));
      for (let row = 0; row < rows; row++) for (let column = 0; column < columns; column++) {
        const height = 8 + random() * 3;
        trees.push({ x: bed.x + (column - (columns - 1) / 2) * Math.min(12, bed.width / 2),
          z: bed.z + (row - (rows - 1) / 2) * 13, height, radius: height * 0.3, species: 'canopy', rotation: random() * Math.PI * 2 });
      }
    }
    addTrees(parent, trees, plan);
  }
  function createPlot(bounds, seed, occupied) {
    const plan = landscapePlan(bounds, style, seed), root = new THREE.Group(); root.name = `exhibition-landscape-${seed}`;
    // Soil is continuous across the scene, rather than a set of rectangular bases.
    if (heritage) plane(root, materials.paving, (bounds.minX + bounds.maxX) / 2, -0.125, (bounds.minZ + bounds.maxZ) / 2,
      bounds.maxX - bounds.minX + 4, bounds.maxZ - bounds.minZ + 4);
    plane(root, materials.paving, plan.court.x, -0.12, plan.court.z, plan.court.width, plan.court.depth);
    plane(root, materials.paving, plan.path.x, -0.14, plan.path.z, plan.path.width, plan.path.depth);
    addTrees(root, plan.trees, plan); benches(root, plan);
    if (heritage) heritageDetails(root, plan); else { modernDetails(root, plan); innerGardens(root, plan, occupied); }
    root.userData.plan = plan; return root;
  }
  function createGround(bounds, plan) {
    const root = new THREE.Group(); root.name = 'exhibition-continuous-ground';
    const width = bounds.maxX - bounds.minX, depth = bounds.maxZ - bounds.minZ;
    const margin = Math.max(4000, width * 2, depth * 2);
    terrain(root, { minX: bounds.minX - margin, maxX: bounds.maxX + margin,
      minZ: bounds.minZ - margin, maxZ: bounds.maxZ + margin }, heritage ? plan : undefined);
    return root;
  }
  function sky() {
    const canvas = document.createElement('canvas'); canvas.width = 4; canvas.height = 512;
    const context = canvas.getContext('2d'), gradient = context.createLinearGradient(0, 0, 0, 512);
    gradient.addColorStop(0, '#aecad1'); gradient.addColorStop(0.55, '#d4e1de'); gradient.addColorStop(1, '#e8eadd');
    context.fillStyle = gradient; context.fillRect(0, 0, 4, 512); return new THREE.CanvasTexture(canvas);
  }
  return { createPlot, createGround, dressBase, sky, dispose() {
    for (const material of Object.values(materials)) material.dispose();
    grassMap.dispose(); pavingMap.dispose(); roadMap.dispose();
    for (const geometry of [unitBox, foliage, trunk, rock]) geometry.dispose();
  } };
}

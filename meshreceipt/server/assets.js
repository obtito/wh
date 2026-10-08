import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Document, NodeIO } from '@gltf-transform/core';
import { makeFixture } from '../test/fixtures.js';
import { DEFAULT_POLICY, sha256 } from '../src/receipt.js';

export const ASSETS = Object.freeze([
  { id: 'pavilion', title: '流光亭', subtitle: '数字建筑 · 程序化共建样例', category: '数字建筑', color: '#bf8c48', serial: '001', story: '以亭台的层叠与留白为灵感，用基础几何构成可继续改造的数字空间。这是项目自有的程序化样例，不是任何真实景点的数字复刻。', accent: '层叠屋檐 · 保留动态', kind: 'pavilion' },
  { id: 'beacon', title: '望潮灯', subtitle: '空间装置 · 程序化共建样例', category: '空间装置', color: '#668e89', serial: '002', story: '一座漂浮于基座之上的几何灯塔，记录数字空间中的微小变化。纹理可以优化，约定的运动不能被悄悄删除。', accent: '几何光塔 · 动画验收', kind: 'beacon' },
  { id: 'arch', title: '回响之门', subtitle: '数字建筑 · 程序化共建样例', category: '数字建筑', color: '#ad7566', serial: '003', story: '由朴素的柱与梁搭起一扇开放的门。每一个交付版本都有自己的文件指纹，方便后来者复核与继续创作。', accent: '开放结构 · 版本指纹', kind: 'arch' },
]);

function cubeGeometry(document, buffer) {
  const positions = [], normals = [], uv = [], indices = [];
  const faces = [
    [[0, 0, 1], [[-1, -1, 1], [1, -1, 1], [1, 1, 1], [-1, 1, 1]]],
    [[0, 0, -1], [[1, -1, -1], [-1, -1, -1], [-1, 1, -1], [1, 1, -1]]],
    [[1, 0, 0], [[1, -1, 1], [1, -1, -1], [1, 1, -1], [1, 1, 1]]],
    [[-1, 0, 0], [[-1, -1, -1], [-1, -1, 1], [-1, 1, 1], [-1, 1, -1]]],
    [[0, 1, 0], [[-1, 1, 1], [1, 1, 1], [1, 1, -1], [-1, 1, -1]]],
    [[0, -1, 0], [[-1, -1, -1], [1, -1, -1], [1, -1, 1], [-1, -1, 1]]],
  ];
  for (const [normal, vertices] of faces) {
    const offset = positions.length / 3;
    vertices.forEach(vertex => { positions.push(...vertex); normals.push(...normal); });
    uv.push(0, 0, 1, 0, 1, 1, 0, 1);
    indices.push(offset, offset + 1, offset + 2, offset, offset + 2, offset + 3);
  }
  const accessor = (name, type, values) => document.createAccessor(name).setType(type).setArray(values).setBuffer(buffer);
  return {
    position: accessor('box-position', 'VEC3', new Float32Array(positions)), normal: accessor('box-normal', 'VEC3', new Float32Array(normals)),
    uv: accessor('box-uv', 'VEC2', new Float32Array(uv)), indices: accessor('box-indices', 'SCALAR', new Uint16Array(indices)),
  };
}

export async function createDisplayAsset(asset) {
  // Reuse only the project-owned image from the original test fixture.
  const fixture = await new NodeIO().readBinary(await makeFixture());
  const image = fixture.getRoot().listTextures()[0].getImage();
  const document = new Document(), buffer = document.createBuffer();
  const texture = document.createTexture('Project texture').setMimeType('image/png').setImage(image.slice());
  const geometry = cubeGeometry(document, buffer);
  const palette = { pavilion: [0.72, 0.48, 0.22, 1], beacon: [0.28, 0.6, 0.56, 1], arch: [0.62, 0.3, 0.22, 1] };
  const material = document.createMaterial('Glazed surface').setBaseColorFactor(palette[asset.kind])
    .setBaseColorTexture(texture).setMetallicFactor(0.28).setRoughnessFactor(0.44);
  const mesh = document.createMesh('Shared block').addPrimitive(document.createPrimitive()
    .setAttribute('POSITION', geometry.position).setAttribute('NORMAL', geometry.normal)
    .setAttribute('TEXCOORD_0', geometry.uv).setIndices(geometry.indices).setMaterial(material));
  const root = document.createNode('Asset');
  const block = (name, translation, scale, parent = root) => {
    const node = document.createNode(name).setMesh(mesh).setTranslation(translation).setScale(scale);
    parent.addChild(node); return node;
  };
  block('Base', [0, 0.1, 0], [1.6, 0.1, 1.6]);
  let animated;
  if (asset.kind === 'pavilion') {
    for (const [i, x, z] of [[0, -1, -1], [1, 1, -1], [2, -1, 1], [3, 1, 1]]) block(`Pillar-${i}`, [x, 1.1, z], [0.1, 0.95, 0.1]);
    block('Roof lower', [0, 2.1, 0], [1.55, 0.1, 1.55]);
    block('Roof upper', [0, 2.32, 0], [1.15, 0.12, 1.15]);
    block('Roof crown', [0, 2.58, 0], [0.55, 0.15, 0.55]);
    animated = block('Lantern', [0, 1.6, 0], [0.22, 0.3, 0.22]);
  } else if (asset.kind === 'beacon') {
    block('Stem', [0, 0.95, 0], [0.25, 0.75, 0.25]);
    block('Platform', [0, 1.75, 0], [0.9, 0.12, 0.9]);
    animated = block('Light', [0, 2.4, 0], [0.48, 0.48, 0.48]);
    animated.setRotation([0, Math.sin(Math.PI / 8), 0, Math.cos(Math.PI / 8)]);
  } else {
    block('Left pillar', [-1, 1.4, 0], [0.22, 1.2, 0.35]);
    block('Right pillar', [1, 1.4, 0], [0.22, 1.2, 0.35]);
    block('Lintel', [0, 2.65, 0], [1.4, 0.25, 0.45]);
    animated = block('Floating seal', [0, 1.65, 0], [0.28, 0.28, 0.28]);
  }
  const scene = document.createScene('Display scene').addChild(root); document.getRoot().setDefaultScene(scene);
  const y = animated.getTranslation()[1];
  const time = document.createAccessor('animation-time').setBuffer(buffer).setType('SCALAR').setArray(new Float32Array([0, 1, 2]));
  const values = document.createAccessor('animation-translation').setBuffer(buffer).setType('VEC3')
    .setArray(new Float32Array([0, y, 0, 0, y + 0.16, 0, 0, y, 0]));
  const sampler = document.createAnimationSampler().setInput(time).setOutput(values).setInterpolation('LINEAR');
  document.createAnimation('Float').addSampler(sampler).addChannel(document.createAnimationChannel()
    .setTargetNode(animated).setTargetPath('translation').setSampler(sampler));
  return new NodeIO().writeBinary(document);
}

export async function ensureAssets(directory) {
  await mkdir(directory, { recursive: true });
  const assets = [];
  for (const asset of ASSETS) {
    const file = path.join(directory, `${asset.id}.glb`);
    let bytes;
    try { bytes = await readFile(file); }
    catch (error) { if (error.code !== 'ENOENT') throw error; bytes = await createDisplayAsset(asset); await writeFile(file, bytes, { flag: 'wx' }); }
    assets.push({ ...asset, source: '项目自有程序化样例', license: 'CC0-1.0（仅本项目自有样例）', bytes: bytes.length,
      inputHash: sha256(bytes), file, policy: { ...DEFAULT_POLICY, requiredNodes: ['Asset'] }, modelUrl: `/api/assets/${asset.id}/model`,
      distributionSource: { assetId: asset.id, title: asset.title, creator: 'MeshReceipt contributors', origin: 'Project-owned procedural sample',
        license: 'CC0-1.0', authorization: 'project-owned-sample', inputHash: sha256(bytes) } });
  }
  return assets;
}

import { Document, NodeIO } from '@gltf-transform/core';
import sharp from 'sharp';

/** Procedural, project-owned fixture. No third-party model/texture licensing. */
export async function makeFixture({ unsupported = false } = {}) {
  const document = new Document();
  const buffer = document.createBuffer();
  const pixels = Buffer.alloc(512 * 512 * 4);
  let seed = 123456789;
  for (let i = 0; i < pixels.length; i += 4) {
    for (let channel = 0; channel < 3; channel++) {
      seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0;
      pixels[i + channel] = seed >>> 24;
    }
    pixels[i + 3] = 255;
  }
  const png = await sharp(pixels, { raw: { width: 512, height: 512, channels: 4 } }).png().toBuffer();
  const texture = document.createTexture('Fixture texture').setImage(new Uint8Array(png)).setMimeType('image/png');
  const material = document.createMaterial('Fixture material').setBaseColorTexture(texture).setDoubleSided(true);
  const accessor = (name, type, values) => document.createAccessor(name).setType(type).setArray(values).setBuffer(buffer);
  const primitive = document.createPrimitive()
    .setAttribute('POSITION', accessor('positions', 'VEC3', new Float32Array([-1, -1, 0, 1, -1, 0, 0, 1, 0])))
    .setAttribute('NORMAL', accessor('normals', 'VEC3', new Float32Array([0, 0, 1, 0, 0, 1, 0, 0, 1])))
    .setAttribute('TEXCOORD_0', accessor('uv', 'VEC2', new Float32Array([0, 0, 1, 0, 0.5, 1])))
    .setMaterial(material);
  const mesh = document.createMesh('Fixture mesh').addPrimitive(primitive);
  const node = document.createNode('Asset').setMesh(mesh);
  document.createScene('Fixture scene').addChild(node);
  const animation = document.createAnimation('Move');
  const sampler = document.createAnimationSampler().setInterpolation('LINEAR')
    .setInput(accessor('time', 'SCALAR', new Float32Array([0, 1, 2])))
    .setOutput(accessor('translation', 'VEC3', new Float32Array([0, 0, 0, 0.5, 0, 0, 0, 0, 0])));
  animation.addSampler(sampler).addChannel(document.createAnimationChannel().setTargetNode(node).setTargetPath('translation').setSampler(sampler));
  if (unsupported) node.setName('');
  return new NodeIO().writeBinary(document);
}

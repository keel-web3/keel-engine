/** Original synthetic fixture, licensed with this repository (MIT).
 * Two materials share an image but have independent transforms. UV0 is the
 * fallback set; the extension selects UV1. No external model/license is needed.
 */
import { writeNativeGlb } from '../src/asset-native-base-v3.ts';
import { encodePng } from '../src/png.ts';
export function textureTransformFixture({ required = false, allRoles = false, set = 1 } = {}) {
  const transform = { offset: [1.25, -.25], rotation: Math.PI / 2, scale: [-.5, 2], texCoord: set };
  const info = (value: any = transform) => ({ index: 0, texCoord: 0, extensions: { KHR_texture_transform: value } });
  const arrays = [new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), new Uint16Array([0, 1, 2]), new Float32Array([.25, .25, .25, .25, .25, .25]), new Float32Array([.125, .25, .75, .125, .25, .75])];
  const json: any = {
    asset: { version: '2.0', generator: 'KEEL synthetic texture-transform regression', extras: { license: 'MIT' } },
    extensionsUsed: ['KHR_texture_transform'], ...(required ? { extensionsRequired: ['KHR_texture_transform'] } : {}),
    accessors: [{ componentType: 5126, type: 'VEC3', count: 3, min: [0, 0, 0], max: [1, 1, 0] }, { componentType: 5123, type: 'SCALAR', count: 3 }, { componentType: 5126, type: 'VEC2', count: 3 }, { componentType: 5126, type: 'VEC2', count: 3 }],
    meshes: [{ primitives: [0, 1].map(material => ({ attributes: { POSITION: 0, TEXCOORD_0: 2, [`TEXCOORD_${set}`]: 3 }, indices: 1, material })) }],
    nodes: [{ mesh: 0 }], scenes: [{ nodes: [0] }], scene: 0,
    materials: [{ pbrMetallicRoughness: { baseColorTexture: info(), metallicFactor: 0 } }, { pbrMetallicRoughness: { baseColorTexture: info({ offset: [.5, .25], scale: [1, -1], texCoord: set }), metallicFactor: 0 } }],
    textures: [{ source: 0, sampler: 0 }], samplers: [{ wrapS: 10497, wrapT: 33648, magFilter: 9728, minFilter: 9728 }], images: [{ mimeType: 'image/png' }],
  };
  if (allRoles) Object.assign(json.materials[0], { normalTexture: { ...info({ rotation: -.3, texCoord: set }), scale: .4 }, occlusionTexture: { ...info({ offset: [.2, .1], texCoord: set }), strength: .7 }, emissiveTexture: info({ scale: [-1, -1], texCoord: set }) });
  if (allRoles) json.materials[0].pbrMetallicRoughness.metallicRoughnessTexture = info({ offset: [.3, .4], scale: [.5, .75], texCoord: set });
  const pixels = new Uint8Array([255, 0, 0, 255, 0, 255, 0, 255, 0, 0, 255, 255, 255, 255, 255, 255]);
  const images = [{ mimeType: 'image/png', data: encodePng({ width: 2, height: 2, data: pixels }) }];
  const glb = () => writeNativeGlb(json, arrays, images);
  const input = () => ({ entry: 'texture-transform.glb', files: [{ name: 'texture-transform.glb', data: glb() }] });
  return { json, arrays, images, glb, input, transform };
}

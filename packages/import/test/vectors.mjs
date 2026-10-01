// Test vectors for keel/import, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":95,"digest":"6a095bcdef678bd4be7f75ebf17beb3104a5dd1f22a86ade38bedeb630d8faaf"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "ab2efb1fc6f9a10d67d198388011be7dcddd0604f2499efe7c7062e6746f8562",
  },
  {
    name: "checksums",
    run: ({ crc32, adler32 }) => { const b = new TextEncoder().encode("keel engine"); return [crc32(b), adler32(b)]; },
    expect: [685480969,419365944],
  },
  {
    name: "colour transfer",
    run: ({ srgbToLinear, linearToSrgb }) => [srgbToLinear(0.5), linearToSrgb(0.214)],
    expect: [0.21404114048223255,0.49995554934020553],
  },
  {
    name: "texture transform uses the overridden UV set before wrapping",
    run: ({ emptyScene, identity, soupOf }) => {
      const scene = emptyScene("gltf", "transformed"), matrix = identity();
      return Array.from(soupOf({ ...scene,
        nodes: [{ name: "triangle", parent: -1, children: [], local: matrix, world: matrix, mesh: 0 }],
        materials: [{ name: "atlas", colour: [1, 1, 1, 1], texture: { texture: 0, texCoord: 1, transform: { offset: [1.25, -.25], rotation: Math.PI / 2, scale: [-.5, 2], texCoord: 1 } } }],
        meshes: [{ name: "triangle", primitives: [{ positions: new Float32Array([0, 0, 0, 1, 0, 0, 0, 1, 0]), indices: new Uint32Array([0, 1, 2]), material: 0, uvs: [new Float32Array(6), new Float32Array([.125, .25, .75, .125, .25, .75])] }] }],
      }).uvs);
    },
    expect: [.75, -.3125, 1, -.625, -.25, -.375],
  },
]);

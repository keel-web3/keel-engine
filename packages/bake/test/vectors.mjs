// Test vectors for keel/bake, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    // (Re-pinned for live meshes and volumes: 13 exports added -- mesh.ts (lookMesh, mergeMeshes, meshMatrix,
    // mulMatrix, poseMatrices, MESH_LIGHTS) and volumes.ts (VolumeInstances, VOLUME_KIND, VOLUME_FLOATS). Nothing that
    // was there changed.)
    // (Re-pinned for the depth sprites (7a5fb59): 27 exports added -- depth.ts (HEIGHT_STEPS, OCCLUSION_LAYERS, SPRITE_DEPTH_GLSL and its functions) and raycast.ts (rayBox/Wedge/Capsule, raycastWorld, placeWorld). Nothing that was there changed.)
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":184,"digest":"5e9e7bc313e2db7467da72869851b7216da0d7ea8b5c05b9a19a0bb300555dc5"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "0f707881da5b078d53e67420b849b28d75c60d42084bfcee1aace395a341f27e",
  },
  {
    name: "texels encode and decode",
    run: ({ encodeTexel, decodeTexel }) => { const t = encodeTexel({ slot: 3, edge: true, behind: false, shade: 2, u: 5, v: 9 }); return [t, decodeTexel(t)]; },
    expect: [[132,2,5,9],null],
  },
  {
    name: "directions and content hashes",
    run: ({ directionFor, contentHash }) => [directionFor(0.3, 0, 8), directionFor(2.9, 1.1, 16), contentHash("keel")],
    expect: [4,13,"da7b74cc6680ae91"],
  },
]);

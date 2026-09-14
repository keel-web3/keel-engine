// Test vectors for keel/bake, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    // (Re-pinned for the depth sprites (7a5fb59): 27 exports added -- depth.ts (HEIGHT_STEPS, OCCLUSION_LAYERS, SPRITE_DEPTH_GLSL and its functions) and raycast.ts (rayBox/Wedge/Capsule, raycastWorld, placeWorld). Nothing that was there changed.)
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":153,"digest":"c4e87f1398c6cff7a0f59f9b05e3b8d297b020ebe66937892baa7727c8079228"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "17ffb077fd9ce262d42b660daa631d0634f5b778262e52e15e6abd0a8384fdc7",
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

// Test vectors for keel/camera, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":25,"digest":"9b672a7c53867a7c1bb2c0ee5f490b273fa884468ddd33d93215b56a2cdbe9c5"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "bf4fc09e0b8da3f09d817bc8e7ee210edab25d9a2c152344de548f7f645e7057",
  },
  {
    name: "directions and field of view",
    run: ({ dirOf, fovForTarget }) => [dirOf(0.5, 0.25), fovForTarget(320, 180), fovForTarget(64, 64)],
    expect: [[0.46452135963892854,0.24740395925452294,0.8503006452922328],1.15,0.9340902558096709],
  },
  {
    name: "a fixed rig",
    run: ({ fixedRig }) => typeof fixedRig,
    expect: "function",
  },
]);

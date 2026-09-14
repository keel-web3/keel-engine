// Test vectors for keel/camera, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":19,"digest":"31c43a6c92e86ad0d9a8357c9c527995ee991b62f31b1054c66ceb280dedddb2"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "e495ee3ab24b7cea877c874fb6d4089384ed21699c543b90469c2e3150a3fcfc",
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

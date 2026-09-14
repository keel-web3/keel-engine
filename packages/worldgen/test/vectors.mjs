// Test vectors for keel/worldgen, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":111,"digest":"be8693feee86af6a904cce95b07f0bda08bbc8b0575c7a818601546eade77a2f"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "4d4e2d2813475089378b98152fbe398db65641bae83e73228ad70fada512df39",
  },
  {
    name: "noise",
    run: ({ simplex2, hashU32, value2 }) => [simplex2(0.5, 1.5, 3), simplex2(10.25, -4, 9), hashU32(3, 4, 5), value2(1.5, 2.5)],
    expect: [0.16073165500719672,0.0898971250684801,99954211,0.39205219462746754],
  },
  {
    name: "stage kinds",
    run: ({ stageKinds }) => stageKinds(),
    expect: ["biome@1","cave@1","dungeon@1","foliage@1","level@1","overworld@1","town@1"],
  },
]);

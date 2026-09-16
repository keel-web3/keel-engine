// Test vectors for keel/worldgen, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    // generateRunner is the one added public function; constants remain unchanged.
    expect: {"count":112,"digest":"022bea514c9aa5ea04bcdb5372ef163d7cb456a023975ad358742e366fadb2f9"},
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

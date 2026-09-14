// Test vectors for keel/terrain, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":106,"digest":"e1f44a859294818902ff3b0f9466651de56812dec0d4e7526245d7f68b433de6"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "dfca5807947b5ea573967203f5b2e67f7ba3720ea15cc2a24da20e85ba6200d1",
  },
  {
    name: "tile indices",
    run: ({ blobIndex, wangIndex, cardinalIndex }) => [0, 1, 7, 31, 255].map((m) => [blobIndex(m), wangIndex(m & 15), cardinalIndex(m)]),
    expect: [[0,0,0],[1,0,1],[4,1,3],[12,1,7],[46,1,15]],
  },
  {
    name: "text hashes",
    run: ({ hashText }) => [hashText("keel"), hashText("terrain")],
    expect: ["1omcwcs","wf9ma6"],
  },
]);

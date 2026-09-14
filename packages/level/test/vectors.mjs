// Test vectors for keel/level, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":37,"digest":"ac54e28ba8bcbc5363e190f6085f0fa52d4ed5452ab7c4097ef2f01ba75c4216"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "d5b2d9d84678ea246c2e1004c0dbcb6bf5d456da2e8733fc6cb02fff54ceae5a",
  },
  {
    name: "symmetric starts",
    run: ({ symmetricPositions }) => symmetricPositions(4, "rotate", 64, 64),
    expect: [[32,55.04],[55.04,32],[32,8.96],[8.96,31.999999999999996]],
  },
  {
    name: "canonical cells",
    run: ({ canonical }) => [canonical(10, 3, 32, 32, "rotate", 4), canonical(5, 30, 32, 32, "mirror", 2)],
    expect: [[10,3],[5,30]],
  },
]);

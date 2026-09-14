// Test vectors for packs/buildings, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../../packages/keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":35,"digest":"9554cb6d86eaab382443e11c42396319cda1827d931df1822d301bb6e999e911"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "18f354b0326eb4682bad80ac25cf760f490e6c54a3a3333a25448d978ddeb156",
  },
  {
    name: "gate widths and sag lines",
    run: ({ gateWidthFor, sagLine }) => [gateWidthFor("wall", 6), gateWidthFor("fence", 3), sagLine([0, 2, 0], [4, 2, 0], 4, 0.5)],
    expect: [5.4,2.4,[[0,2,0],[1,1.625,0],[2,1.5,0],[3,1.625,0],[4,2,0]]],
  },
  {
    name: "the pack's objects",
    run: ({ pack }) => (pack.objects ?? []).map((o) => o.id),
    expect: ["building","cottage","tower","hall","workshop","shop","hab","dome","pylon","hive","factory","bridge","ramp","stairs","cliff-steps","wall","fence","gate","path-stones","dock"],
  },
]);

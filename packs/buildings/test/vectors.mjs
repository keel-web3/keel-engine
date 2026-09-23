// Test vectors for packs/buildings, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../../packages/keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":52,"digest":"fb6c1a899ca17b8c26aa1a52138f267048f6b37cf487419125246196248a7626"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "4bf495297b75fddce0a5adfff4a799b2c00a509b5052ffb79acbdd3dc1fd4dec",
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

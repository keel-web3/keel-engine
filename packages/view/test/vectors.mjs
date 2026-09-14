// Test vectors for keel/view, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":33,"digest":"d2d2c8d6f11658da367c428d913ac156bb3ce10bad75aa216ac2116ffee08aa3"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "f60d8c7e9ab80ed7d1a0561d2ea0cc000142681f6515b151cf55b9de00f17ef3",
  },
  {
    name: "the zoom ladder",
    run: ({ zoomLadder, nearestRung }) => { const l = zoomLadder(); return [l, nearestRung(l, 30)]; },
    expect: [[2,2.4,2.8,3.4,4,5,6,7,8,10,11,13,16,19,23,27,32,38,45,54,64,76,91,108,128],32],
  },
  {
    name: "possession commands encode",
    run: ({ encodeCommands, decodeCommands }) => Array.from(encodeCommands([])),
    expect: [],
  },
]);

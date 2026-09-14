// Test vectors for keel/capture, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":5,"digest":"8bb267ddd15a364e75f6d3413f5f3d90a63ccf591b846c7f7d99fe9aea8a3d32"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  },
  {
    name: "video scale and mime choice",
    run: ({ videoScale, pickMime }) => [videoScale(128, 128), videoScale(640, 360), pickMime(null, (t) => t.includes("webm"))],
    expect: [8,1,"video/webm;codecs=vp9"],
  },
  {
    name: "rows flip",
    run: ({ flipRows }) => Array.from(flipRows(new Uint8Array([1, 2, 3, 4, 5, 6, 7, 8]), 1, 2)),
    expect: [5,6,7,8,1,2,3,4],
  },
]);

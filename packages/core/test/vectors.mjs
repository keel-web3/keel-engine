// Test vectors for keel/core, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":114,"digest":"42ba0377e1386097c99aa91abfbf8c197fd2d4032bfe7232e27ea271bdcbc2fc"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "763603fae52a3a083013396f71327d9cf316c95069efe88973180d03750608b4",
  },
  {
    name: "value noise and fbm are deterministic",
    run: ({ vnoise2, fbm2, hash2 }) => [vnoise2(0.5, 1.5), vnoise2(3.25, -2, 7), fbm2(0.3, 0.7, 11), hash2(4, 9, 3)],
    expect: [0.2912852555164136,0.2597379146318417,0.38955764171135526,0.5850013650488108],
  },
  {
    name: "oklch converts to sRGB",
    run: ({ oklch, hueName }) => [oklch(0.7, 0.1, 200), oklch(0.4, 0.15, 30), hueName(200)],
    expect: [[64,177,183],[134,19,9],"Teal"],
  },
  {
    name: "seeded streams replay",
    run: ({ createRoll, stream, deriveSeed }) => { const s = stream(createRoll(deriveSeed("0x2a", "vectors")), 3); return [s.f(), s.int(1, 6), s.between(-1, 1), s.pick(["a", "b", "c"])]; },
    expect: [0.7616729736328125,6,-0.70257568359375,"b"],
  },
]);

// Test vectors for keel/particles, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":37,"digest":"70d069ad5669c579d461bf4b8a5240a9d464ddf6f817cc1587eb0d3fa2c6adc7"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "ed9006a7bd987729e5b79fdb374c2d9a9f09585170dfe3b7136bba1dd0aa6aa7",
  },
  {
    name: "curves and hashing",
    run: ({ sampleCurve, mix32 }) => [sampleCurve(undefined, 0.5), sampleCurve([0, 1, 0.5], 0.25), mix32(1), mix32(123456789)],
    expect: [1,0.5,1753845952,2834422664],
  },
  {
    name: "sprite indices",
    run: ({ spriteIndex, PARTICLE_SPRITES }) => PARTICLE_SPRITES.map((s) => spriteIndex(s)),
    expect: [0,1,2,3,4,5],
  },
]);

// Test vectors for packs/creatures, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../../packages/keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":8,"digest":"b257ce4cb5f02fc46f54874f1cff7a4adbe617642768f05bccf95e1241c36420"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "96a9a7c81e74d8a9250d54dd2f50c5311b505ff314a2a76f18bfd21174a58a17",
  },
  {
    name: "plans and rigs",
    run: ({ CREATURE_PLANS, CREATURE_RIGS }) => [Object.keys(CREATURE_PLANS).sort(), Object.keys(CREATURE_RIGS).sort()],
    expect: [["0","1","2","3","4","5","6"],["crawler","floater","flyer","rider","serpent","strider","walker"]],
  },
  {
    name: "the pack's entities",
    run: ({ pack }) => pack.entities.map((e) => e.id),
    expect: ["crawler","walker","strider","floater","flyer","rider","serpent"],
  },
]);

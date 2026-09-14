// Test vectors for keel/world, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":18,"digest":"afa014c7c67db0b3ed64cb40abf769a8048e837352955c6109c40dbd2f9ceb09"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "4d45d6702bbc11fbf18c7504e9ec16c69ebc49f6de55e3575444bcacde3c31bf",
  },
  {
    name: "world seeds and named streams",
    run: ({ worldSeed, namedStream }) => { const s = namedStream(worldSeed(42), "vectors"); return [worldSeed(42), s.f ? s.f() : Object.keys(s).sort()]; },
    expect: ["0xb203894d3fbfd002f1c69c6ce9b9389d2956f4b98fc02be2f74e36408518d965",0.8358306884765625],
  },
  {
    name: "lock text parses",
    run: ({ parseLocks }) => parseLocks("render/scale=2;world/seed=7"),
    expect: [{"key":"scale","lock":true,"scope":"render","value":2},{"key":"seed","lock":true,"scope":"world","value":7}],
  },
]);

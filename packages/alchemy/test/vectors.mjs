// Test vectors for keel/alchemy, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":23,"digest":"dee034280cb10f92092e88cf8298bb454d5549f283ee5d281d7d6f2a7014ffe8"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "756673e49c63d2c61fa093917f78ba6c4e93c44ebf27074c5f446541ff675adc",
  },
  {
    name: "an expression evaluates as it always has",
    run: ({ evalExpr }) => [evalExpr(["add", ["var", "power"], 1], { power: 3 }), evalExpr(["min", 4, ["mul", 2, 3]], {})],
    expect: [4, 4],
  },
]);

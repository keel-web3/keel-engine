// Test vectors for keel/input, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":4,"digest":"90b1ed75db2c5b4ff3a68237f5c779d2c5aa8d1b663f437ad121cc7210e67e41"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "a69581e5d493681292e9f5c510f3873a259cd0181b1646b4732fd4ad1dad9ca0",
  },
  {
    name: "key codes",
    run: ({ codeOf }) => [codeOf({ code: "KeyW" }), codeOf({ code: "Space" }), codeOf(null)],
    expect: ["KeyW","Space",null],
  },
  {
    name: "the arbiter starts on autopilot",
    run: ({ createArbiter }) => { const a = createArbiter(); return Object.keys(a).sort(); },
    expect: ["driver","giveBack","idle","idleFor","takeOver","update"],
  },
]);

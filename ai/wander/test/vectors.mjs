// Test vectors for ai/wander, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../../packages/keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":27,"digest":"42c834531e109bba673cb78fa674150fb411115408aafdea99a38b5f86b335ba"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "77bad4dbd5e8441004c761b0c0ce6c7a4163f4cb394432f62615a6d4954b3e94",
  },
  {
    name: "vector steering helpers",
    run: ({ limit, turn, wrap }) => [limit([3, 4], 1), turn(0, 3, 0.5), wrap(7)],
    expect: [[0.6000000000000001,0.8],0.5,0.7168146928204135],
  },
  {
    name: "the ai's contract and defaults",
    run: ({ contract, id, DEFAULTS }) => [contract, id, DEFAULTS],
    expect: ["ai/animal@1.0.0","ai/wander",{"bodyR":0.3,"calmFor":2,"dt":0.03333333333333333,"fleeRadius":4,"idleFor":[1.5,4],"jitter":1.6,"margin":1.5,"maxAccel":3,"maxTurn":4,"personal":0.9,"runSpeed":3,"sitChance":0.3,"sitFor":[4,10],"walkFor":[3,8],"walkSpeed":0.9}],
  },
]);

// Test vectors for ai/herd, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../../packages/keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":27,"digest":"a395b414240432ac18ff4f16bf0fd630e833f0909016faaed824cf7cbbffd29f"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "f32915a8e4f006d534aec9553dd621808fa55036287c844e47eb5dec5b5d3113",
  },
  {
    name: "vector steering helpers",
    run: ({ limit, turn, wrap }) => [limit([3, 4], 1), turn(0, 3, 0.5), wrap(7)],
    expect: [[0.6000000000000001,0.8],0.5,0.7168146928204135],
  },
  {
    name: "the ai's contract and defaults",
    run: ({ contract, id, DEFAULTS }) => [contract, id, DEFAULTS],
    expect: ["ai/animal@1.0.0","ai/herd",{"alarm":true,"bodyR":0.3,"calmFor":2,"dt":0.03333333333333333,"fleeRadius":5,"followGap":1.5,"jitter":1.2,"leader":false,"leaderView":12,"margin":1.5,"maxAccel":3,"maxTurn":4,"restFor":[2,6],"runSpeed":3.2,"separation":1,"view":4,"wAlignment":1,"wCohesion":0.8,"wLeader":1.2,"wSeparation":2.5,"walkFor":[4,9],"walkSpeed":1}],
  },
]);

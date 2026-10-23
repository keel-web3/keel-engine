// Test vectors for keel/handheld, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":28,"digest":"4ba7e67e813f8de67da54b2f07b85b7a4e62e1fd5bb2e3f93e28d32940bec458"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "b8df2bbfde1e266eaf16224eda75d75926222b105498296e925e3f1c8e4ac1ff",
  },
  {
    name: "both levels of detail build the same parts everywhere",
    run: ({ buildParts }) => ["grid", "solo"].map((d) => buildParts(d, true).parts.reduce((n, p) => n + p.mesh.indices.length / 3, 0)),
    expect: [7258,18126],
  },
  {
    name: "the face's hit map",
    run: ({ hitFace, toPlan, MM }) => [hitFace(...toPlan(MM.a.x, MM.a.y)), hitFace(...toPlan(MM.dpad.x - 8, MM.dpad.y)), hitFace(...toPlan(38, 35.5)), hitFace(...toPlan(60, 125))],
    expect: [{"kind":"key","key":"a"},{"kind":"key","key":"left"},{"kind":"screen","u":0.5000000000000001,"v":0.5},{"kind":"body"}],
  },
]);

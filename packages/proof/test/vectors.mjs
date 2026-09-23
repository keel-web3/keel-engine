// Test vectors for keel/proof, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":36,"digest":"867bd343b422599c5bd12a639e6b6c9101ee5d5da1c50d74da6371bfa4deeb8d"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "44136fa355b3678a1146ad16f7e8649e94fb4fc21fe77e8310c060f61caaff8a",
  },
  {
    // The Rust twin (zk/keel-proof) pins the same numbers: a change here is a change to every proof.
    name: "the roll rolls exactly as it always has",
    run: ({ rollKey, roll, below, programIdOf }) => {
      const k = rollKey(programIdOf("keel/proof/test"));
      return [...k, roll(k, 0, 0, 0, 0), roll(k, 1, 2, 3, 4), roll(k, 0xffffffff, 7, 0, 1), below(k, 1000000, 5, 6, 7, 8)];
    },
    expect: [3578586263, 3043208446, 2911776024, 668755810, 1665936403, 920335],
  },
]);

// Test vectors for keel/decal, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":20,"digest":"c6d998e52225d943e870539e065ff176cf56ec15af21a1bb9190b36e7e712e7f"},
  },
  {
    // The alphabet and both fonts: a change here re-draws every decal already on-chain.
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "b793712d00a0921a2a61d83e866ea2d3e11b59317f8c444286ea9aef55c413c2",
  },
]);

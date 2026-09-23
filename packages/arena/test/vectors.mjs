// Test vectors for keel/arena, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":15,"digest":"f00524948095862eefcd35789b19cde97674da9d7c8ffbc2499f673a59c9396b"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "adbd319bf231eaabc7156b2eeeca83866b795a4c96901dc223b67e610adfecb8",
  },
]);

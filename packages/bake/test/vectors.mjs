// Test vectors for keel/bake, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":126,"digest":"58c9d0ff4f8f69b675f44c83de85a77940e1c8cd94fa38c1c1af1ddcf86e119a"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "ca9977fa61ab29254f096d7660c7aa533ff3dcc55f86f8e34d7dcff26be105f8",
  },
  {
    name: "texels encode and decode",
    run: ({ encodeTexel, decodeTexel }) => { const t = encodeTexel({ slot: 3, edge: true, behind: false, shade: 2, u: 5, v: 9 }); return [t, decodeTexel(t)]; },
    expect: [[132,2,5,9],null],
  },
  {
    name: "directions and content hashes",
    run: ({ directionFor, contentHash }) => [directionFor(0.3, 0, 8), directionFor(2.9, 1.1, 16), contentHash("keel")],
    expect: [4,13,"da7b74cc6680ae91"],
  },
]);

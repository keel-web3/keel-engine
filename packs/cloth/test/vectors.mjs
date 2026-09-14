// Test vectors for packs/cloth, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../../packages/keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":14,"digest":"86b5b4c9017f52be57a084e9457a5c55cab3e8e9601ae4dfb37b697233215d10"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "d5ad2beda6558563f1a1d8110ed876f5a7eb1a19d935054445eb759f6af0d33e",
  },
  {
    name: "the pack's attributes and their targets",
    run: ({ pack }) => pack.attributes.map((a) => [a.id, a.slot ?? null]),
    expect: [["beanie","head"],["cap","head"],["top-hat","head"],["hood","head"],["horned-helmet","head"],["backpack-round","back"],["backpack-tall","back"],["flag","back"],["cape","back"],["scarf","neck"],["glasses","face"],["boots-l","foot.L"],["boots-r","foot.R"]],
  },
]);

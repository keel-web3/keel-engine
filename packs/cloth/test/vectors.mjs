// Test vectors for packs/cloth, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../../packages/keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":23,"digest":"b62157875e36f5fb2f4a53fb3c0b6a400810f634c03e2223b023edcb5da9b172"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "35fe624ce7b61cd6fe1e2372e543d7982f9b0ce446536c8b41a3449a4b4a2ace",
  },
  {
    name: "the pack's attributes and their targets",
    run: ({ pack }) => pack.attributes.map((a) => [a.id, a.slot ?? null]),
    expect: [["beanie","head"],["cap","head"],["top-hat","head"],["hood","head"],["horned-helmet","head"],["backpack-round","back"],["backpack-tall","back"],["flag","back"],["cape","back"],["scarf","neck"],["glasses","face"],["boots-l","foot.L"],["boots-r","foot.R"],["wizard-hat","head"],["circlet","head"],["horns","head"],["mask","face"],["pauldrons","chest"],["breastplate","chest"],["belt","waist"],["quiver","back"],["beard","face"]],
  },
]);

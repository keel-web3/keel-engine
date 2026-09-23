// Test vectors for keel/ads, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

const slots = [{ id: "7:0:0:billboard", kind: "billboard", size: [12, 5], pos: [3, 20, -4], normal: [0, 1] }, { id: "3:1:0:roof", kind: "backlit", size: [6, 2], pos: [-8, 30, 12], normal: [1, 0] }];

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":8,"digest":"032dd20b57794f1c2cf965a96d9a19bc8c7ee104102523fc53d70a1df5a21281"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "95755c422a5b96093ff513689678c2b5cfe9317caf0e1337d065c8d28aef50a3",
  },
  {
    name: "house ads are the same brands from the same seed, and links stay http(s)",
    run: async ({ houseSource, safeHref }) => {
      const got = await houseSource("neon", { href: "https://example.com/city" }).resolve(slots, 0);
      return [...got.values()].map((c) => [c.title, c.line, c.hue, c.href]).concat([[safeHref("javascript:x"), safeHref("https://a.b/c")]]);
    },
    expect: [["NOVA SPORTS","ASK FOR IT BY NAME",66,"https://example.com/city"],["NOVA COLA","THE CITY'S FINEST",254,"https://example.com/city"],[null,"https://a.b/c"]],
  },
]);

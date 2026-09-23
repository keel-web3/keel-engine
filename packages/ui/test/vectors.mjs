// Test vectors for keel/ui, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":189,"digest":"e9fa6b220a7a190bec592e009fe77d16c77184780984671553da3248c5329d47"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "3e798f176791142c9c2c00e97c576fc126f7b891005d50a0d4b9f47a99fec3e8",
  },
  {
    name: "colours and contrast",
    run: ({ fromHex, contrast, luminance }) => { const a = fromHex("#101018"), b = fromHex("#f0e8d0"); return [a, b, luminance(b), contrast(a, b)]; },
    expect: [4279767056,4291881200,0.8079255694709048,15.467345759610035],
  },
  {
    name: "a generated theme",
    run: async ({ generateTheme, encodeTheme, toBase64 }) => { const t = generateTheme({ seed: 7, culture: "clean" }); return typeof encodeTheme === "function" ? Array.from(encodeTheme(t)).length : Object.keys(t).sort(); },
    expect: 27,
  },
]);

// Test vectors for keel/render, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":45,"digest":"949d4f1594f5df7ac7ddd8efdf7eca47b125c596f96879769c343e99861988d1"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "4ec0385069a5a38bfcb48b66d27550a1ea7783ad8cf1b203e3a70ccbc5f86f81",
  },
  {
    name: "fx resolve and toggle",
    run: ({ resolveFx, toggleFx, FX_NAMES }) => [resolveFx([], 128).length, toggleFx([], FX_NAMES[0], true), FX_NAMES],
    expect: [0,[{"name":"crt","on":true}],["crt","grade","fog","glow","rim","flash","vignette","scanlines","dither","outline","cycle"]],
  },
  {
    name: "a screen tile",
    run: ({ screenTile }) => Array.from(screenTile("bayer4", 8)),
    expect: [8,135,40,167,8,135,40,167,199,72,231,104,199,72,231,104,56,183,24,151,56,183,24,151,247,120,215,88,247,120,215,88,8,135,40,167,8,135,40,167,199,72,231,104,199,72,231,104,56,183,24,151,56,183,24,151,247,120,215,88,247,120,215,88],
  },
]);

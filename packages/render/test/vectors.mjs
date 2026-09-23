// Test vectors for keel/render, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    // (Re-pinned for the depth sprites (7a5fb59): 2 exports added -- the heights pass's HEIGHT_FS shader and unpackHeight. Nothing that was there changed.)
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":47,"digest":"ed521cbec16ec32ce3ca76291ee69dbd0d3270297f386314b79d36ef16ff5b34"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "e3e3330647e23d8dd557c34cb9bce5ad2f982426ff2a65acb9f18996c2f242f6",
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

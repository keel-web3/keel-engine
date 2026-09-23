// Test vectors for keel/replay, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":14,"digest":"b0d286e51bc63cbc945dfde3750e9f345c1d859462a61b54330f334f66ba6931"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "6e72613b6474a5dd23b9c48b4d4e61033e89551ba04e08a943811df2c23437b7",
  },
  {
    name: "the hash mixes exactly as it always has",
    run: ({ mix32 }) => [mix32(0), mix32(1), mix32(0x9e3779b9)],
    expect: [0, 1364076727, 2462723854],
  },
  {
    name: "base64url round-trips a tape's bytes",
    run: ({ toBase64url, fromBase64url }) => {
      const bytes = Uint8Array.from([0, 1, 2, 250, 251, 252, 253, 254, 255]);
      return Array.from(fromBase64url(toBase64url(bytes)));
    },
    expect: [0, 1, 2, 250, 251, 252, 253, 254, 255],
  },
]);

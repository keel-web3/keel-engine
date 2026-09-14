// Test vectors for keel/audio, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":79,"digest":"2f09f9d09ee74170cceed48fd6b610f8b544d815b2dba870979d9b40a42bbc5c"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "104b1f8128213fd77112c2cf619eb5ec9fd55e30722e68d5d345d3c5b5fb1681",
  },
  {
    name: "pitch and hashing",
    run: ({ midiHz, hash }) => [midiHz(69), midiHz(60), hash("keel"), hash("engine")],
    expect: [440,261.6255653005986,3665523916,3993360443],
  },
  {
    name: "a WAV header and samples",
    run: ({ encodeWav }) => Array.from(encodeWav([new Float32Array([0, 0.5, -0.5, 1])], 8000)),
    expect: [82,73,70,70,44,0,0,0,87,65,86,69,102,109,116,32,16,0,0,0,1,0,1,0,64,31,0,0,128,62,0,0,2,0,16,0,100,97,116,97,8,0,0,0,0,0,0,64,1,192,255,127],
  },
  {
    name: "diatonic chords",
    run: ({ diatonic }) => [diatonic("ionian", 0), diatonic("dorian", 4)],
    expect: [{"deg":0,"root":0,"tones":[4,7,11,14]},{"deg":4,"root":7,"tones":[10,14,17,21]}],
  },
]);

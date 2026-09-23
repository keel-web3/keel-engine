// Test vectors for keel/audio, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":90,"digest":"b935da434ab5cec8afed642d3460b702c5f53e62b5d6863159d188613710c7c5"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "42300bc2158460544a7703bd6b55fcdb083ce6034a499192aaaea9e4d52501b3",
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

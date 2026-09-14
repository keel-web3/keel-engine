// Test vectors for keel/object, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":83,"digest":"3c7eb02819017689281102fe53be4a4ee0e6b10cab8321afd8c5c41d6c64097a"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "decadfb47e14114d3340d71ef8ea3e1963acd90a9adc3b9b08e38fd362666127",
  },
  {
    name: "text hashes and choice grids",
    run: ({ hashText, gridOf }) => [hashText("keel"), gridOf([0, 1]), gridOf(["a", "b", "c"])],
    expect: ["11ufognflif",[0,1],["a","b","c"]],
  },
  {
    name: "piece streams replay",
    run: ({ pieceStream }) => { const s = pieceStream("0x07", 2); return [s.f(), s.int(0, 9), s.pick(["x", "y"])]; },
    expect: [0.2865142822265625,2,"y"],
  },
]);

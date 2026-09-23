// Test vectors for keel/road, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":21,"digest":"41bf892a6e73dd704983695fe2be0e48ad0bd831359d573ba21c7c41a7202cdb"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "39d5dfcccd0f06c855f63551a4164bc9adc05335010e97bc36b0b1fd679d3ce8",
  },
  {
    name: "a loop through five points samples to the same metres and the same curvature",
    run: async ({ pathThrough }) => {
      const p = pathThrough([0, 60, 90, 20, -50], [0, 20, 90, 120, 60], { closed: true });
      return digest([Array.from(p.x), Array.from(p.curve)]);
    },
    expect: "8b1f2eed2231482f74568b2e57f82779accc9866aa2ee484fe6eb95141dc8b01",
  },
  {
    name: "its road field's chunk is the same bytes",
    run: async ({ pathThrough, loopGraph, roadField }) => {
      const p = pathThrough([0, 60, 90, 20, -50], [0, 20, 90, 120, 60], { closed: true });
      return digest([Array.from(roadField(loopGraph(p, "arterial")).chunk(0, 0).data)]);
    },
    expect: "67647077dabfe0a35094e3acbf75c39872b9ca944ad57bf8709b15692613e74b",
  },
]);

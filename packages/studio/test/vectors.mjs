// Test vectors for keel/studio, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":63,"digest":"7ba1d79fbedbc1d99ad1323d10b9313f070cede4417837e96a5665b6ebd9e3c2"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "86e81ea1aef2fe486c01363a8d04eaeba808b49fb76073b268d3466734bbe65a",
  },
  {
    name: "a bevelled slab is built the same everywhere",
    run: async ({ slab, roundedRect }) => { const m = slab(roundedRect(0, 0, 10, 6, 1), -1, 1, { size: 0.3, kind: "chamfer" }, { size: 0.3, kind: "round", steps: 3 }, { seg: 4 }); return { vertices: m.positions.length / 3, triangles: m.indices.length / 3, digest: await digest(Array.from(m.positions, (v) => Math.round(v * 1e5))) }; },
    expect: {"vertices":187,"triangles":236,"digest":"b0de455b79e4c0c166bf5414672ecfe39945976be7bcc06fe9e113e374ef897a"},
  },
  {
    name: "the house studio's radiance (presentation)",
    run: ({ STUDIO, studioRadiance }) => [studioRadiance(STUDIO, [-0.55, 0.5, 0.68]), studioRadiance(STUDIO, [0, -1, 0.0001]), studioRadiance(STUDIO, [0.95, 0.12, 0.28])].map((c) => c.map((v) => Math.round(v * 1e6) / 1e6)),
    expect: [[4.324221,4.195354,4.03316],[0.02,0.019,0.021],[5.287605,5.447804,5.617924]],
  },
]);

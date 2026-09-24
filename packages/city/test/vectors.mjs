// Test vectors for keel/city, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":52,"digest":"59ac1cf86962f17f3a154baf465cbce2c263a5f2d37931903b563e328b46fdb0"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "cc0bb5617fbfede83d22cef87219eaed7745d7fbd3ca04a6839abd01f0ce3c5a",
  },
  {
    name: "the city of 'neon' is the same junctions, roads and lots",
    run: async ({ generateCity }) => {
      const c = generateCity("neon");
      return digest([c.graph.nodes, c.graph.edges.map((e) => [e.a, e.b, e.cls, e.path.length]), c.lots]);
    },
    expect: "fc52f290a76b35e51d47117167cf166198168b308264fc39d235b0e2c759b677",
  },
  {
    name: "the city of 'neon' has the same districts, and the same ground under it",
    run: async ({ generateCity, cityHeight }) => {
      const c = generateCity("neon"), h = cityHeight(c, 4);
      return { districts: await digest(c.districts), grid: [h.grid.w, h.grid.h], ground: await digest(Array.from(h.grid.data)), at: [h.heightAt(0, 0), h.heightAt(137.5, -210.25)] };
    },
    expect: {"at":[1.0891671031713486,0.42647294886410236],"districts":"80acb2b980107e346137cd12de46796c2f595ba7e1ea8666d6156f0526d0852e","grid":[578,556],"ground":"ab110a9b271355c283143f962ca18f77ee1a6c2d599d1b95f54824c412f67cb2"},
  },
]);

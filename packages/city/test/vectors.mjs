// Test vectors for keel/city, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":61,"digest":"d13727181975136fea851efb1d6afa02914e9069254d1d7af6cca89e97e21d80"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "9c912f4ba07e742586baffbc8efc85ea626c0251869ea39aeb9ab4cc41d8673f",
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
    expect: {"at":[1.0891673266887665,0.4266322592739016],"districts":"80acb2b980107e346137cd12de46796c2f595ba7e1ea8666d6156f0526d0852e","grid":[578,556],"ground":"c7590d7d1ae5981c61e98120084ea117560464446ab54111f81c70079e92ab61"},
  },
  {
    name: "the world of 'neon' is the same places and links, their roads and decks",
    run: async ({ generateCityWorld }) => {
      const w = generateCityWorld("neon");
      return digest([w.places, w.links.map((l) => [l.id, l.kind, l.a, l.b, l.at, l.seam, l.clearance, Array.from(l.path.x), Array.from(l.path.z), Array.from(l.y)])]);
    },
    expect: "cac4d0d656a6be222cafbd7bb845fda45815e8a4817de5511c4eac2c50366285",
  },
  {
    name: "the second place of 'neon' is the same roads, its portals where its links start",
    run: async ({ generateCityWorld, worldCity }) => {
      const c = worldCity(generateCityWorld("neon"), 1);
      return digest([c.graph.nodes, c.graph.edges.map((e) => [e.a, e.b, e.cls, e.path.length, !!e.bridge]), c.portals, c.lots.length]);
    },
    expect: "39b98a0b4eb35aed4ad6c5818a485ba51052530976b9c187053a9131ffb75e1d",
  },
]);

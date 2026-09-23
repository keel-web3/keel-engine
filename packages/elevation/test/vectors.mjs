// Test vectors for keel/elevation, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":17,"digest":"3b54f462195778f004590c32a9b4edd9584213d64270df8cc773f216eae0db43"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "9a09bcbaa5ace49bf02ae023264b0d5098ba0a96ce36b1a930e16b437f05b18b",
  },
  {
    name: "hills from a seed, a road graded over them and a pad levelled land on the same bits",
    run: async ({ addHills, gridOver, gradeCorridor, levelRect }) => {
      const g = addHills(gridOver(-200, -200, 400, 400, 4), "vector", { amplitude: 18, scale: 180 });
      const road = gradeCorridor(g, [-180, 0, 180], [-20, 30, -10], { half: 6, blend: 10, maxGrade: 0.08 });
      const pad = levelRect(g, 60, -80, 24, 16, 0.4, { blend: 5 });
      return digest([Array.from(g.data), Array.from(road.y), pad]);
    },
    expect: "185b4c82394477eb12eecdfa0ccc19a8156d1b1259074a6189b425ed7b6dc12b",
  },
]);

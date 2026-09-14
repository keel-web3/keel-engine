// Test vectors for keel/scene, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":75,"digest":"d9dc6ee5843f617d7d508eb4f00ea7fb3f308229d56df620c6fbb88e932c1bb1"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "bdbe2d1bd2a5bddc0478caa4a0da5e78a3dbe14d92bbbf70f3a31b2a6b82eece",
  },
  {
    name: "a box shape's distance and bounds",
    run: ({ box }) => { const b = box([0, 1, 0], [1, 1, 1]); return [b.f(0, 1, 0), b.f(3, 1, 0), b.b]; },
    expect: [-1,1.9999999999999998,[-1,0,-1,1,2,1]],
  },
  {
    name: "angles",
    run: ({ angleOf, angleBetween }) => [angleOf([1, 0, 1]), angleBetween([1, 0, 0], [0, 0, 1])],
    expect: [null,null],
  },
]);

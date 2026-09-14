// Test vectors for keel/physics, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":11,"digest":"4a1aad60892323c96164895964e651d22585d815415ef9f25c1d9b7584f266cb"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "d47351dc316acb2055c029a6c6bf8229ad97da6de91991215c0f87ac9370b1c5",
  },
  {
    name: "box and wedge distances",
    run: ({ boxDistance, wedgeDistance }) => [boxDistance([2, 0.5, 0], { c: [0, 0.5, 0], h: [1, 0.5, 1] }), wedgeDistance([0, 2, 0], { c: [0, 0.5, 0], h: [1, 0.5, 1], yaw: 0 })],
    expect: [{"d":1,"n":[1,0,0]},{"d":1.3416407864998738,"n":[0,0.8944271909999159,0.447213595499958]}],
  },
  {
    name: "slopes",
    run: ({ slopeOf }) => [slopeOf({ h: [1, 0.5, 2] }), slopeOf({ h: [2, 1, 1], lo: 0.25 })],
    expect: [0.24497866312686414,0.6435011087932844],
  },
]);

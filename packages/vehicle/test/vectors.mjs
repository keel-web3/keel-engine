// Test vectors for keel/vehicle, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":32,"digest":"b932f949a57ccd1cea76c4cad0c708b2cc0a592c7b744c17b7e25706f48b6561"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "fd4858cdc4ddb01b11d6074ab8cc160d1fc76c94d19831aeb378125d8a76bd1e",
  },
  {
    name: "the tyre curve rises to its peak at 1 and eases off past it",
    run: ({ curve }) => [0, 0.5, 1, 2, 8].map((s) => curve(s)),
    expect: [0, 0.8561966106283367, 1, 0.9103825970367276, 0.6901127271569882],
  },
  {
    name: "five seconds of flat-out weaving with handbrake flicks lands the car on the same bits",
    run: async ({ createVehicle, stepVehicle, DEFAULT_SPEC }) => {
      const car = createVehicle(DEFAULT_SPEC, 0, 0, 0.3);
      for (let i = 0; i < 300; i += 1) stepVehicle(car, { throttle: 1, brake: 0, steer: ((i % 120) - 60) / 60, handbrake: i % 100 < 10 ? 1 : 0 }, 1 / 60);
      return digest([car.p, car.q, car.v, car.w]);
    },
    expect: "19c2d04eca23adbc61b078d50d2e768cb5c992dca3450814b83647e485582bce",
  },
  {
    name: "the same weave with the handling assists on, nitrous and a wall scrape, lands on the same bits",
    run: async ({ createVehicle, stepVehicle, wallContact, DEFAULT_SPEC }) => {
      const car = createVehicle(DEFAULT_SPEC, 0, 0, 0.3);
      for (let i = 0; i < 300; i += 1) {
        stepVehicle(car, { throttle: 1, brake: 0, steer: ((i % 120) - 60) / 60, handbrake: i % 100 < 10 ? 1 : 0, boost: i > 200 ? 1 : 0, arcade: 0.7 }, 1 / 60);
        if (car.p[0] > 2) wallContact(car, 1, 0, car.p[0] - 2, 1 / 60, 0.7);
      }
      return digest([car.p, car.q, car.v, car.w]);
    },
    expect: "9c8e6348080b862df7c8c3aea1cdb09a2fd9589c52b7c363ce00e23ef35debec",
  },
]);

// Test vectors for packs/vehicles, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../../packages/keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":88,"digest":"233fd4b553cd6fba8838ef7b7001a34a78df9503ffe47c277c064af15cdd7770"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "e4abf11860c10b41d614468de5d5f3b656e51df5753ca7784d50de6be48f33cf",
  },
  {
    name: "a seed makes the same car, trait for trait",
    run: ({ generateCar }) => {
      const car = generateCar("vector:1");
      return [car.name, car.style, car.tier, Math.round(car.score)];
    },
    expect: ["Corvane Apex R", "Bubble Hyper", "common", 91],
  },
  {
    name: "a special style is built only by name, and never drawn",
    run: ({ generateCar }) => {
      const semi = generateCar("vector:semi", { style: "Semi Truck" });
      return [semi.style, semi.mounts.length, semi.body.length, semi.parts.semi.sleeper, generateCar("vector:1").style];
    },
    expect: ["Semi Truck", 6, 6.65, 0, "Bubble Hyper"],
  },
  {
    name: "how many cars there are",
    run: ({ possibleCars }) => String(possibleCars()),
    expect: "31090982340365646865367040",
  },
]);

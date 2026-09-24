// Test vectors for packs/vehicles, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../../packages/keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":95,"digest":"79e54c60340aa68683bff6320a94b15b6e7e817624481fe04fa920c474f76264"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "5f152c6dfee4fdecda134f8c28b22217e0932b4dfb890487eea6b5d1468b9ca7",
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

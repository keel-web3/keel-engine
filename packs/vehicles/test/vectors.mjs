// Test vectors for packs/vehicles, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../../packages/keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":68,"digest":"dea84250ef319c1da0b9c8f0cafa2f858d27e3ebd277ebb4cb6d8448ea66ae66"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "22d8b4ab90e8c2b808321e215ec92570fff4f1db1f455172083d1cb9407accae",
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
    expect: "10363660780121882288455680",
  },
]);

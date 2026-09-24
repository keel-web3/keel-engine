// Test vectors for packs/vehicles, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../../packages/keel/src/vectors.ts";

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":99,"digest":"9e7110319b401aef3225bac87a82fac84e8ea97279ef6c09b3fe23ee9ee62d36"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "3612208eaaf03cc1eb47bfd7c2b638efa8fee2fe02cb551df1a3952bd48f5be6",
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
    name: "the city's service vehicles are built only by name, never drawn",
    run: ({ generateCar, SERVICE_STYLES }) => [
      ...Object.values(SERVICE_STYLES).map((style) => {
        const c = generateCar("vector:service", { style });
        return [c.style, c.mounts.length, Math.round(c.body.length * 100) / 100, c.parts.service.kind, c.parts.service.form, !!c.parts.beacons];
      }),
      generateCar("vector:1").style,
    ],
    expect: [["City Bus", 4, 11.75, "bus", "diesel", false], ["Fire Engine", 4, 10.1, "fire", "pumper", true], ["Ambulance", 4, 7.3, "ambulance", "type3", true], ["Police Cruiser", 4, 4.78, "police", "cruiser", true], ["Dump Truck", 6, 8.6, "dump", "tipper", true], "Bubble Hyper"],
  },
  {
    name: "beacons are dark without a phase, flash half against half with one, and touch no other car",
    run: ({ generateCar, carLights }) => {
      const cop = generateCar("vector:service", { style: "Police Cruiser" }), plain = generateCar("vector:1");
      const lit = (c, beacon) => { const l = carLights(c, { night: true, braking: 0, neon: 0, ...(beacon === undefined ? {} : { beacon }) }); return [l.glow[30], l.glow[31], l.bloom[123], l.bloom[127]].map((v) => Math.round(v * 100)); };
      return [lit(cop), lit(cop, 0.05), lit(cop, 0.55), lit(plain), lit(plain, 0.05)];
    },
    expect: [[-42, -42, 0, 0], [85, -42, 100, 0], [-42, 85, 0, 100], [0, 0, 0, 0], [0, 0, 0, 0]],
  },
  {
    name: "the cars there were are the cars there are: data, bodies and lights (pinned before the service vehicles)",
    run: async ({ generateCar, carDesigns, carLights }) => {
      const cars = [...Array.from({ length: 20 }, (_, i) => generateCar(`vector:pin:${i}`)), generateCar("vector:pin", { style: "Semi Truck" }), generateCar("vector:pin", { style: "Sports Sedan" })];
      return digest(cars.map((c) => [c, carDesigns(c).body.pose("still", 0), carLights(c, { night: true, braking: 1, neon: 1 })]));
    },
    expect: "f5420e5a5884bd812d139e7884bfa9fe99930c1ef657be2265213e62c5d80ab5",
  },
  {
    name: "how many cars there are",
    run: ({ possibleCars }) => String(possibleCars()),
    expect: "31090982340365646865367040",
  },
]);

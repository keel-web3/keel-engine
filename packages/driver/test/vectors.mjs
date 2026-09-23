// Test vectors for keel/driver, run by `keel module test` against the readable build and
// the shipped bytes, each in a clean process (see packages/keel/src/vectors.ts).
import { engineVectors, surface, digest, dataDigest } from "../../keel/src/vectors.ts";

// (A 120 m right-hander, a metre a sample, heading off along +z: built here so the vector needs nothing but keel/driver.)
const arc = () => {
  const L = 400, x = new Float64Array(L), z = new Float64Array(L), yaw = new Float64Array(L), curve = new Float64Array(L);
  for (let i = 0; i < L; i += 1) { const a = i / 120; x[i] = 120 - Math.cos(a) * 120; z[i] = Math.sin(a) * 120; yaw[i] = a; curve[i] = 1 / 120; }
  return { x, z, yaw, curve, length: L, closed: false };
};

export default await engineVectors(import.meta.url, [
  {
    name: "the export surface is intact",
    run: async (api) => { const names = surface(api); return { count: names.length, digest: await digest(names) }; },
    expect: {"count":9,"digest":"ee59a498cac6b5b08a97a870cf5d315a491d167872fd360b658e29a94e9bc3b5"},
  },
  {
    name: "its tables and constants are intact",
    run: (api) => dataDigest(api),
    expect: "610d53c2563074d6d96ae9b326f0caa373af635ff2786f9ecddcf972f14861ed",
  },
  {
    name: "on a sweeping right-hander it keeps the throttle pinned and dials in a touch of lock",
    run: ({ drive }) => drive({ x: 0.5, z: 0.2, yaw: 0.05, speed: 25, yawRate: 0.15, spec: { grip: 1, steerLock: 0.55, frontAxle: 1.3, rearAxle: -1.3 } }, arc(), 0.5, { skill: 0.9, line: 0, look: 1 }, [], { half: 7.3 }),
    expect: {"throttle":1,"brake":0,"steer":0.04992942400201032},
  },
  {
    name: "a driver from a seed has the same instincts and skills, and makes the same mistake on the same stretch",
    run: async ({ generateDriver, driverSeed, mistakeAt }) => {
      const d = generateDriver(driverSeed("vector-driver"), "muscle");
      const slips = Array.from({ length: 400 }, (_, n) => { const m = mistakeAt(d.seed, n, d.skills, 1 / 45, 30, 0.5, 1, d.mistakes, d.size); return m ? `${n}:${m.kind}` : ""; }).filter(Boolean);
      return digest([d.instincts.map((i) => i.name), d.skills, d.mistakes, d.size, d.rarity, slips]);
    },
    expect: "205342a3a0cd966c68ac87f6c519e782be293e69a4368a11fbc89b9ec0241e2a",
  },
]);

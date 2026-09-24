// An energy (or crystal) body coming apart: a flash, a few glassy shards spalling off, and a cloud of motes
// rising and curling away as they fade. No corpse.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [18, 26], shape: "sphere", radius: 0.5, speed: [0.1, 0.4], up: [0.8, 1.8], priority: 2, reach: 4,
  particle: {
    life: [0.8, 1.5], size: [0.06, 0.11], light: [0.6, 1], lightCurve: [1, 1.1, 0.8], alpha: [1, 1, 0.6, 0],
    ramp: "energy", drag: 0.8, gravity: -0.5, turbulence: 0.35,
  },
  also: [
    {
      mode: "burst", count: [1, 1], shape: "point", speed: [0, 0], offset: [0, 0.5, 0], priority: 2, reach: 2,
      particle: { life: [0.08, 0.14], size: [0.6, 0.9], sizeCurve: [0.8, 1.2, 0.4], light: [0.95, 1], ramp: "energy", depthBias: 0.3 },
    },
    {
      mode: "burst", count: [3, 5], shape: "cone", dir: [0, 1, 0], angle: 1, speed: [1.5, 3], priority: 1, reach: 3,
      particle: { life: [0.5, 0.9], size: [0.06, 0.1], light: [0.6, 1], lightCurve: [1, 0.7, 1, 0.6], alpha: [1, 1, 1, 0.3], ramp: "crystal", gravity: 9.8, drag: 0.3, ground: "bounce", bounce: 0.45 },
    },
  ],
});

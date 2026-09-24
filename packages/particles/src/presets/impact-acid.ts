// An acid hit (spit, bile, corrosive spray): a yellow-green splash that sticks where it lands, some of it
// hissing up in a wisp, and a short sizzle of vapour off the struck point.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [8, 12], shape: "cone", dir: [0, 1, 0], angle: 1.2, speed: [1, 2.5], up: [0.5, 1], priority: 2, reach: 2,
  particle: {
    life: [1.5, 2.5], size: [0.06, 0.12], light: [0.5, 0.95], alpha: [1, 1, 1, 0.7, 0],
    ramp: "acid", gravity: 9.8, drag: 0.4, ground: "stick",
    sub: [{
      on: "ground", chance: 0.4, count: [1, 1], inherit: 0,
      emit: { mode: "burst", count: [1, 1], shape: "point", speed: [0, 0.1], up: [0.3, 0.6], priority: 0, reach: 1, particle: { life: [0.5, 0.9], size: [0.1, 0.16], sizeCurve: [0.5, 1.3], light: [0.55, 0.85], alpha: [0.7, 0.4, 0], ramp: "acid", drag: 2, gravity: -0.3, wind: 0.8, turbulence: 0.2 } },
    }],
  },
  also: [{
    mode: "continuous", rate: 10, duration: 0.8, shape: "disc", radius: 0.25, speed: [0, 0.1], up: [0.3, 0.6], priority: 1, budget: 10, reach: 2,
    particle: { life: [0.5, 0.9], size: [0.1, 0.18], sizeCurve: [0.5, 1.2, 1.4], light: [0.5, 0.8], alpha: [0.7, 0.5, 0], ramp: "acid", drag: 2, gravity: -0.3, wind: 0.8, turbulence: 0.2 },
  }],
});

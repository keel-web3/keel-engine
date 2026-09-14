// A splat of alien ichor: as blood, green-gold, and where it lands some of it hisses up in an acid wisp.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [12, 20], shape: "cone", dir: [0, 1, 0], angle: 1.1, speed: [1.5, 4], up: [0.5, 1.5], priority: 1, reach: 3,
  particle: {
    life: [2.5, 4], size: [0.06, 0.14], light: [0.45, 0.9], alpha: [1, 1, 1, 0.8, 0],
    ramp: "ichor", gravity: 9.8, drag: 0.4, ground: "stick",
    sub: [{
      on: "ground", chance: 0.3, count: [1, 1], inherit: 0,
      emit: { mode: "burst", count: [1, 1], shape: "point", speed: [0, 0.1], up: [0.3, 0.6], priority: 0, reach: 1, particle: { life: [0.6, 1], size: [0.1, 0.16], sizeCurve: [0.5, 1.3], light: [0.5, 0.8], alpha: [0.7, 0.4, 0], ramp: "ichor", drag: 2, gravity: -0.3, wind: 0.8 } },
    }],
  },
});

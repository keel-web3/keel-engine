// A magic swirl: glints thrown out of a ring and turned (curl) into a rising spiral, bright, then gone.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 50, shape: "ring", radius: 0.7, speed: [0.8, 1.2], up: [0.6, 1.2], priority: 2, budget: 90, reach: 3,
  particle: {
    life: [0.8, 1.4], size: [0.08, 0.16], light: [0.7, 1], lightCurve: [1, 1, 0.6], alpha: [1, 1, 0.5, 0],
    ramp: "magic", sprite: "spark", curl: 3, drag: 0.3,
  },
});

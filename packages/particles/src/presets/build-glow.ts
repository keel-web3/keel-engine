// Energy / crystal construction: motes of light drawn in from a ring, spiralling (curl) toward the heart of
// the structure as they rise and brighten.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 18, shape: "ring", radius: 1.2, speed: [-1.4, -1], up: [0.3, 0.6], priority: 1, budget: 24, reach: 2,
  particle: {
    life: [0.7, 1], size: [0.05, 0.09], light: [0.6, 1], lightCurve: [0.8, 1, 1.1], alpha: [0.2, 1, 1, 0.5],
    ramp: "energy", curl: 2.5,
  },
});

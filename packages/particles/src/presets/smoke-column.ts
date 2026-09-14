// A column of smoke (a burning wreck, a signal fire): puffs that rise, grow, thin and lean with the wind.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 14, shape: "disc", radius: 0.4, speed: [0.1, 0.3], up: [1, 1.6], priority: 1, budget: 120, reach: 12,
  particle: {
    life: [3, 5], size: [0.6, 1], sizeCurve: [0.5, 1.2, 2], light: [0.4, 0.65], lightCurve: [1, 1.15, 1.25], alpha: [0.9, 0.8, 0.5, 0],
    ramp: "smoke", soft: 0.45, shade: 0.6, drag: 0.6, gravity: -0.3, wind: 1, curl: 0.2,
  },
});

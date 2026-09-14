// Heavy damage: a dense column of dark smoke rising well above a burning building -- soft round puffs thrown
// up fast, slowing to a steady climb, growing as they go, leaning a little with the wind.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 10, shape: "disc", radius: 0.3, speed: [0.02, 0.15], up: [1.6, 2.4], priority: 1, budget: 38, reach: 12,
  particle: {
    life: [2.2, 3.2], size: [0.4, 0.65], sizeCurve: [0.55, 1.1, 1.7], light: [0.1, 0.28], lightCurve: [1, 1.2, 1.5], alpha: [1, 0.95, 0.7, 0],
    ramp: "smoke", sprite: "puff", soft: 0.35, shade: 0.55, drag: 0.35, gravity: -0.4, wind: 0.7, curl: 0.15,
  },
});

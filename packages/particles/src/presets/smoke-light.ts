// Light damage: a thin, pale thread of smoke off a building's roof -- small, soft, round puffs that rise and
// thin out in a couple of seconds. A damaged base has many of these, so each is cheap.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 5, shape: "disc", radius: 0.2, speed: [0, 0.12], up: [0.7, 1.1], priority: 1, budget: 12, reach: 6,
  particle: {
    life: [1.4, 2.2], size: [0.3, 0.45], sizeCurve: [0.55, 1.1, 1.5], light: [0.6, 0.8], lightCurve: [1, 1.1], alpha: [1, 0.85, 0.5, 0],
    ramp: "smoke", sprite: "puff", soft: 0.35, shade: 0.4, drag: 0.7, gravity: -0.35, wind: 0.9, curl: 0.2,
  },
});

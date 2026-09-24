// Embers: sparks off a fire rising on the heat, curling and carried by the wind, cooling as they go.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 8, shape: "disc", radius: 0.3, speed: [0.1, 0.4], up: [1.5, 3], priority: 1, budget: 40, reach: 6,
  particle: {
    life: [1.2, 2.2], size: [0.04, 0.08], light: [0.7, 1], lightCurve: [1, 0.8, 0.5], alpha: [1, 1, 0.8, 0],
    ramp: "ember", drag: 0.8, gravity: -0.4, wind: 0.9, turbulence: 0.5,
  },
});

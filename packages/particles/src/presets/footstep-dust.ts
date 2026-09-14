// Dust kicked up by marching feet: a trail laid per metre walked, kicked back against the stride. Ambient
// (an army's dust is the first thing dropped when the pool is busy) and capped per unit.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "trail", perMetre: 2.5, shape: "disc", radius: 0.2,
  speed: [0.1, 0.4], up: [0.1, 0.4], inherit: -0.2, priority: 0, budget: 40, reach: 1.5,
  particle: {
    life: [0.4, 0.8], size: [0.15, 0.3], sizeCurve: [0.7, 1.2],
    light: [0.5, 0.75], alpha: [0.9, 0.6, 0],
    ramp: "dust", soft: 0.5, shade: 0.4, drag: 4, gravity: -0.1, wind: 0.6,
  },
});

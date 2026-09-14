// A puff of dust: something landed, a hoof struck, a shell hit the dirt. A low ring of soft, shaded puffs
// that roll out, slow, lift a little and thin away.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [6, 10], shape: "disc", radius: 0.3,
  speed: [0.5, 1.5], up: [0.2, 0.8], priority: 1, reach: 2,
  particle: {
    life: [0.5, 0.9], size: [0.25, 0.45], sizeCurve: [0.6, 1, 1.3],
    light: [0.55, 0.8], lightCurve: [1, 0.9], alpha: [1, 1, 0.7, 0],
    ramp: "dust", soft: 0.5, shade: 0.5, drag: 3, gravity: -0.2, wind: 0.5,
  },
});

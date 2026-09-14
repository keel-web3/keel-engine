// A splat of blood: droplets thrown up and out that fall and stick where they land, fading off the ground.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [12, 20], shape: "cone", dir: [0, 1, 0], angle: 1.1, speed: [1.5, 4], up: [0.5, 1.5], priority: 1, reach: 3,
  particle: {
    life: [2.5, 4], size: [0.06, 0.14], light: [0.45, 0.85], alpha: [1, 1, 1, 0.8, 0],
    ramp: "blood", gravity: 9.8, drag: 0.4, ground: "stick",
  },
});

// A splash: something hit the water -- a crown of drops thrown up from a small ring, falling back.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [14, 22], shape: "ring", radius: 0.15, speed: [0.6, 1.6], up: [2, 4], priority: 1, reach: 3,
  particle: {
    life: [0.4, 0.8], size: [0.06, 0.12], light: [0.6, 1], ramp: "water", sprite: "drop", gravity: 9.8, drag: 0.5, ground: "die",
  },
});

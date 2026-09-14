// An organic unit hurting: a few drops of ichor shaken off its body that fall and stick. A burst, thrown
// every couple of seconds while it's hurt.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [2, 4], shape: "point", speed: [0.2, 0.6], up: [0.2, 0.6], priority: 1, reach: 1.5,
  particle: {
    life: [1, 1.6], size: [0.05, 0.09], light: [0.35, 0.8], alpha: [1, 1, 1, 0.7, 0],
    ramp: "ichor", sprite: "drop", gravity: 9.8, drag: 0.3, ground: "stick",
  },
});

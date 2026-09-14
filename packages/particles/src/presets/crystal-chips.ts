// A crystalline thing cracking: a few glassy chips spalling off that glint, fall and skitter, and a glint of
// light where they broke. A burst, thrown every couple of seconds while it's hurt.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [3, 5], shape: "cone", dir: [0, 1, 0], angle: 1, speed: [1.5, 3], priority: 1, reach: 2,
  particle: {
    life: [0.5, 0.9], size: [0.06, 0.11], light: [0.6, 1], lightCurve: [1, 0.7, 1, 0.6], alpha: [1, 1, 1, 0.4],
    ramp: "crystal", gravity: 9.8, drag: 0.3, ground: "bounce", bounce: 0.45, friction: 0.7,
  },
  also: [{
    mode: "burst", count: [1, 1], shape: "point", speed: [0, 0], priority: 1, reach: 1,
    particle: { life: [0.05, 0.09], size: [0.16, 0.24], sizeCurve: [1, 0.5], light: [0.95, 1], ramp: "crystal", depthBias: 0.15 },
  }],
});

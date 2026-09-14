// A kinetic hit (bullets, slugs, claws on plate): a few quick sparks snapping off the struck point and a
// speck of dust. Small and fast -- a gatling's worth of them should read as a patter, not a fireworks show.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [3, 6], shape: "cone", dir: [0, 1, 0], angle: 1.2, speed: [2, 5], priority: 2, reach: 2,
  particle: {
    life: [0.08, 0.2], size: [0.04, 0.08], light: [0.8, 1], lightCurve: [1, 0.7],
    ramp: "spark", streak: 0.02, gravity: 9.8, drag: 1,
  },
  also: [{
    mode: "burst", count: [1, 2], shape: "point", speed: [0.1, 0.4], up: [0.2, 0.5], priority: 1, reach: 1,
    particle: { life: [0.25, 0.45], size: [0.12, 0.2], sizeCurve: [0.6, 1.2], light: [0.5, 0.75], alpha: [0.9, 0.5, 0], ramp: "dust", soft: 0.5, shade: 0.4, drag: 3, gravity: -0.2, wind: 0.5 },
  }],
});

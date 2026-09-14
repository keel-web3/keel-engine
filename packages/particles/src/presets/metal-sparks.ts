// A machine unit hurting: a quick spit of sparks from a torn seam and a pop of light. A burst -- the damage
// system throws one every couple of seconds while the unit is damaged.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [4, 7], shape: "cone", dir: [0, 1, 0], angle: 0.9, speed: [2, 4.5], priority: 1, reach: 2,
  particle: {
    life: [0.25, 0.5], size: [0.04, 0.07], light: [0.8, 1], lightCurve: [1, 0.75, 0.5],
    ramp: "spark", streak: 0.03, gravity: 9.8, drag: 0.5, ground: "bounce", bounce: 0.3, friction: 0.6,
  },
  also: [{
    mode: "burst", count: [1, 1], shape: "point", speed: [0, 0], priority: 1, reach: 1,
    particle: { life: [0.04, 0.07], size: [0.14, 0.2], light: [0.9, 1], ramp: "flash", depthBias: 0.15 },
  }],
});

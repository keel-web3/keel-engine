// A warp-in starting: a ring of light that hangs a moment and draws in, a column of specks rising through
// it, and a flash at its heart as it closes. Scale it with the footprint.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [22, 28], shape: "ring", radius: 1, speed: [-0.6, -0.45], priority: 2, reach: 3,
  particle: {
    life: [0.6, 0.8], size: [0.08, 0.12], light: [0.75, 1], lightCurve: [0.9, 1, 1.1], alpha: [1, 1, 0.6, 0],
    ramp: "energy", depthBias: 0.1,
  },
  also: [
    {
      mode: "burst", count: [8, 12], shape: "disc", radius: 0.5, speed: [0, 0.1], up: [1.5, 3], priority: 1, reach: 3,
      particle: { life: [0.4, 0.7], size: [0.05, 0.08], light: [0.7, 1], lightCurve: [1, 0.7], alpha: [1, 1, 0], ramp: "energy", streak: 0.02, drag: 1 },
    },
    {
      mode: "burst", count: [1, 1], delay: 0.55, shape: "point", speed: [0, 0], offset: [0, 0.4, 0], priority: 2, reach: 2,
      particle: { life: [0.1, 0.15], size: [0.6, 0.8], sizeCurve: [0.6, 1.2, 0.4], light: [0.95, 1], ramp: "energy", depthBias: 0.3 },
    },
  ],
});

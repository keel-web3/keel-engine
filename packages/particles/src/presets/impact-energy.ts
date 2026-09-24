// An energy hit (lasers, plasma, psionic bolts): a bright core flash, a ring of light snapping outward and
// stopping dead (heavy drag), and a few specks curling away as they cool through blue.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [1, 1], shape: "point", speed: [0, 0], priority: 2, reach: 2,
  particle: {
    life: [0.06, 0.1], size: [0.4, 0.5], sizeCurve: [1, 1.3, 0.6], light: [0.95, 1], ramp: "energy", depthBias: 0.2,
  },
  also: [
    {
      mode: "burst", count: [10, 14], shape: "ring", radius: 0.1, speed: [2.5, 3.5], priority: 2, reach: 2,
      particle: { life: [0.12, 0.2], size: [0.08, 0.12], light: [0.85, 1], lightCurve: [1, 0.8], alpha: [1, 1, 0.3], ramp: "energy", drag: 6, depthBias: 0.1 },
    },
    {
      mode: "burst", count: [5, 8], shape: "sphere", radius: 0.1, speed: [0.5, 1.5], priority: 1, reach: 2,
      particle: { life: [0.3, 0.6], size: [0.04, 0.07], light: [0.6, 1], lightCurve: [1, 0.8, 0.5], alpha: [1, 1, 0.5, 0], ramp: "energy", drag: 1.5, gravity: -0.5, turbulence: 0.35 },
    },
  ],
});

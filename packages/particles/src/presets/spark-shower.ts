// A shower of sparks (a grinder, a shorting cable, a blade on armour): hot streaks flung up and out, falling,
// bouncing, and a few dying into a wisp of smoke.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 60, shape: "cone", dir: [0, 1, 0], angle: 0.7,
  speed: [3, 7], priority: 1, reach: 5, budget: 120,
  particle: {
    life: [0.3, 0.7], size: [0.05, 0.1], light: [0.8, 1], lightCurve: [1, 0.8, 0.5],
    ramp: "spark", streak: 0.035, gravity: 9.8, drag: 0.5, ground: "bounce", bounce: 0.35, friction: 0.6,
    sub: [{
      on: "death", chance: 0.25, count: [1, 1], inherit: 0.1,
      emit: {
        mode: "burst", count: [1, 1], shape: "point", speed: [0, 0.1], up: [0.2, 0.5], priority: 0, reach: 1,
        particle: { life: [0.4, 0.7], size: [0.1, 0.18], sizeCurve: [0.6, 1.4], light: [0.4, 0.6], alpha: [0.8, 0.5, 0], ramp: "smoke", soft: 0.5, drag: 2, gravity: -0.4, wind: 0.8, turbulence: 0.6 },
      },
    }],
  },
});

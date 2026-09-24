// Fire: flames licking up and shrinking as they cool through the ramp, the odd puff of smoke off the top,
// and embers (the "embers" preset) rising with it.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 40, shape: "disc", radius: 0.35, speed: [0, 0.3], up: [1, 2], priority: 2, budget: 80, reach: 4,
  particle: {
    life: [0.4, 0.8], size: [0.25, 0.45], sizeCurve: [1, 0.8, 0.3], light: [0.75, 1], lightCurve: [1.1, 0.85, 0.55], alpha: [1, 1, 0.6],
    ramp: "fire", sprite: "flame", drag: 1.5, gravity: -2, wind: 0.4, turbulence: 0.12, turbulenceScale: 0.8,
    sub: [{
      on: "death", chance: 0.12, count: [1, 1], inherit: 0.3,
      emit: { mode: "burst", count: [1, 1], shape: "point", speed: [0, 0.2], up: [0.4, 0.8], priority: 0, reach: 6, particle: { life: [1, 1.8], size: [0.3, 0.5], sizeCurve: [0.6, 1.5], light: [0.3, 0.5], alpha: [0.8, 0.5, 0], ramp: "smoke", soft: 0.5, shade: 0.5, drag: 0.8, gravity: -0.4, wind: 1, turbulence: 0.6 } },
    }],
  },
  also: ["embers"],
});

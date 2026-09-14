// Rain over the whole picture: streaks falling from above the view (its area is the ground the view shows,
// so the rate follows the view), leaning with the wind, dying on the ground into a tiny splash.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", density: 0.4, shape: "area", area: "view", offset: [0, 12, 0],
  speed: [0, 0.2], velocity: [0, -14, 0], priority: 0, reach: 0,
  particle: {
    life: [1.2, 1.4], size: [0.04, 0.06], light: [0.6, 0.9], ramp: "water", streak: 0.035, wind: 0.3, ground: "die",
    sub: [{
      on: "ground", chance: 0.5, count: [1, 2], inherit: 0,
      emit: { mode: "burst", count: [1, 1], shape: "point", speed: [0.3, 0.8], up: [0.8, 1.5], priority: 0, reach: 1, particle: { life: [0.15, 0.25], size: [0.04, 0.05], light: [0.7, 1], ramp: "water", gravity: 9.8 } },
    }],
  },
});

// Organic construction: the thing grows. Spores drift up off the growing mass, fading in and curling on the
// air; now and then one ripens into a drip of ichor that falls back (a death sub-emit). One emitter.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 10, shape: "disc", radius: 0.8, speed: [0, 0.15], up: [0.3, 0.7], priority: 1, budget: 20, reach: 3,
  particle: {
    life: [1, 1.8], size: [0.06, 0.12], light: [0.55, 0.95], alpha: [0.3, 1, 1, 0.6, 0],
    ramp: "spore", drag: 1, gravity: -0.2, wind: 0.4, turbulence: 0.45,
    sub: [{
      on: "death", chance: 0.25, count: [1, 1], inherit: 0,
      emit: { mode: "burst", count: [1, 1], shape: "point", speed: [0, 0.05], priority: 0, reach: 2, particle: { life: [0.5, 0.8], size: [0.05, 0.08], light: [0.45, 0.8], ramp: "ichor", sprite: "drop", gravity: 6, drag: 0.3, ground: "die" } },
    }],
  },
});

// An acid glob in flight: a fat green-yellow glob, and drops falling off it along the way (a death sub-emit:
// each speck of the glob, as it goes, lets a drop fall). Drive it as "tracer".
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 40, duration: 0.1, shape: "point", speed: [0, 0.1], inherit: 0.7, priority: 2, budget: 10, reach: 5,
  particle: {
    life: [0.06, 0.1], size: [0.12, 0.16], light: [0.6, 0.95], ramp: "acid", shade: 0.4, streak: 0.012, depthBias: 0.1,
    sub: [{
      on: "death", chance: 0.5, count: [1, 1], inherit: 0.2,
      emit: { mode: "burst", count: [1, 1], shape: "point", speed: [0, 0.1], priority: 1, reach: 3, particle: { life: [0.3, 0.6], size: [0.05, 0.08], light: [0.5, 0.85], ramp: "acid", sprite: "drop", gravity: 9.8, drag: 0.3, ground: "die" } },
    }],
  },
});

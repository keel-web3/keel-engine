// A blast round in flight (a rocket, a grenade, a fire-glob): an orange ball with a short, thin trail of smoke
// puffs (a death sub-emit off each speck of the ball). Drive it as "tracer".
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 40, duration: 0.1, shape: "point", speed: [0, 0.1], inherit: 0.7, priority: 2, budget: 10, reach: 5,
  particle: {
    life: [0.06, 0.1], size: [0.14, 0.2], light: [0.7, 0.95], ramp: "fire", shade: 0.3, streak: 0.012, depthBias: 0.1,
    sub: [{
      on: "death", chance: 0.6, count: [1, 1], inherit: 0,
      emit: { mode: "burst", count: [1, 1], shape: "point", speed: [0, 0.1], up: [0.1, 0.3], priority: 0, reach: 3, particle: { life: [0.35, 0.65], size: [0.16, 0.26], sizeCurve: [0.6, 1.3], light: [0.35, 0.6], alpha: [0.85, 0.5, 0], ramp: "smoke", soft: 0.4, drag: 2, gravity: -0.3, wind: 0.6 } },
    }],
  },
});

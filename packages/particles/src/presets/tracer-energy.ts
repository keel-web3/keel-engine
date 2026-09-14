// An energy bolt in flight: a bright cyan bolt shedding violet glow specks behind it (a live sub-emit, so
// the one emitter is all there is to stop). Drive it as "tracer".
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 50, duration: 0.1, shape: "point", speed: [0, 0.1], inherit: 0.7, priority: 2, budget: 12, reach: 5,
  particle: {
    life: [0.06, 0.1], size: [0.08, 0.12], light: [0.85, 1], ramp: "energy", streak: 0.025, depthBias: 0.15,
    sub: [{
      on: "live", rate: 25, inherit: 0.25,
      emit: { mode: "burst", count: [1, 1], shape: "point", speed: [0, 0.2], priority: 1, reach: 2, particle: { life: [0.08, 0.14], size: [0.14, 0.2], sizeCurve: [1, 0.6], light: [0.7, 0.95], alpha: [0.8, 0.5, 0], ramp: "magic", soft: 0.6, drag: 3, depthBias: 0.05 } },
    }],
  },
});

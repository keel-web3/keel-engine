// A piercing round in flight (a spine, a needle, a sabot): a thin, long, white-blue needle. Drive it as
// "tracer": each tick with { velocity }, or on a moving anchor with { unit, duration: Infinity }.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 60, duration: 0.1, shape: "point", speed: [0, 0.1], inherit: 0.8, priority: 2, budget: 12, reach: 6,
  particle: {
    life: [0.05, 0.08], size: [0.03, 0.04], light: [0.8, 1], lightCurve: [1, 0.85],
    ramp: "snow", streak: 0.06, depthBias: 0.1,
  },
});

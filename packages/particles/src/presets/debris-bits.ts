// A damaged structure shedding: now and then a hot chip of plating tumbles off, spitting sparks as it falls
// (a live sub-emit), and bounces. Sparse by design -- "a few bits". One emitter.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 1.2, shape: "cone", dir: [0, 1, 0], angle: 0.9, speed: [1, 2.5], priority: 1, budget: 6, reach: 4,
  particle: {
    life: [0.8, 1.4], size: [0.07, 0.14], light: [0.2, 0.6], ramp: "metal", gravity: 9.8, ground: "bounce", bounce: 0.3, friction: 0.5,
    sub: [{
      on: "live", rate: 5, inherit: 0.3,
      emit: { mode: "burst", count: [1, 1], shape: "sphere", speed: [1, 2.5], priority: 1, reach: 3, particle: { life: [0.2, 0.4], size: [0.04, 0.06], light: [0.8, 1], lightCurve: [1, 0.7], ramp: "spark", streak: 0.03, gravity: 9.8, drag: 0.5 } },
    }],
  },
});

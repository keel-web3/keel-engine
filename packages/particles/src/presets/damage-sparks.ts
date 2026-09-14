// A damaged machine structure shorting out: every so often a bright pop of light spits a shower of sparks
// (a live sub-emit) that fall and bounce -- the at-a-glance "this building is hurt" flicker. One emitter.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 2.2, shape: "sphere", radius: 0.1, speed: [0, 0], priority: 1, budget: 2, reach: 4,
  particle: {
    life: [0.1, 0.16], size: [0.24, 0.34], sizeCurve: [1, 0.5], light: [0.9, 1], ramp: "flash", depthBias: 0.2,
    sub: [{
      on: "live", rate: 110, inherit: 0,
      emit: {
        mode: "burst", count: [1, 1], shape: "cone", dir: [0, 1, 0], angle: 1.1, speed: [2.5, 5], priority: 1, reach: 4,
        particle: { life: [0.3, 0.6], size: [0.07, 0.1], light: [0.8, 1], lightCurve: [1, 0.8, 0.5], ramp: "spark", streak: 0.03, gravity: 9.8, drag: 0.5, ground: "bounce", bounce: 0.3, friction: 0.6 },
      },
    }],
  },
});

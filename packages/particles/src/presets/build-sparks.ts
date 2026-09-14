// Machine construction: welding at the work point -- small white arc-flashes, each spitting a little shower
// of sparks (a live sub-emit) that fall and bounce. Emit it where a builder works and stop it when it's done.
// (One emitter, no continuous companion: pool.stop() stops the lot.)
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 4, shape: "sphere", radius: 0.15, speed: [0, 0], priority: 1, budget: 3, reach: 3,
  particle: {
    life: [0.06, 0.1], size: [0.18, 0.3], sizeCurve: [1, 0.6], light: [0.9, 1], ramp: "flash", depthBias: 0.2,
    sub: [{
      on: "live", rate: 70, inherit: 0,
      emit: {
        mode: "burst", count: [1, 1], shape: "cone", dir: [0, 1, 0], angle: 1, speed: [1.5, 3.5], priority: 1, reach: 3,
        particle: { life: [0.2, 0.5], size: [0.04, 0.07], light: [0.8, 1], lightCurve: [1, 0.8, 0.5], ramp: "spark", streak: 0.025, gravity: 9.8, drag: 0.5, ground: "bounce", bounce: 0.3, friction: 0.6 },
      },
    }],
  },
});

// A siege shell in flight: a big dark shell with a bright core riding on it (a live sub-emit moving with the
// shell, drawn in front of it) and a trail of dark smoke (a death sub-emit off each speck). Drive it as "tracer".
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 40, duration: 0.1, shape: "point", speed: [0, 0.05], inherit: 0.8, priority: 2, budget: 12, reach: 8,
  particle: {
    life: [0.06, 0.1], size: [0.2, 0.26], light: [0.08, 0.22], ramp: "metal", shade: 0.5, streak: 0.01, depthBias: 0.1,
    sub: [
      {
        on: "live", rate: 50, inherit: 1,
        emit: { mode: "burst", count: [1, 1], shape: "point", speed: [0, 0], priority: 2, reach: 2, particle: { life: [0.03, 0.05], size: [0.08, 0.1], light: [0.95, 1], ramp: "flash", depthBias: 0.25 } },
      },
      {
        on: "death", chance: 0.8, count: [1, 1], inherit: 0,
        emit: { mode: "burst", count: [1, 1], shape: "point", speed: [0, 0.1], up: [0.1, 0.3], priority: 0, reach: 4, particle: { life: [0.6, 1], size: [0.26, 0.4], sizeCurve: [0.6, 1.3, 1.5], light: [0.2, 0.4], alpha: [0.9, 0.6, 0.25, 0], ramp: "smoke", soft: 0.4, shade: 0.4, drag: 1.5, gravity: -0.3, wind: 0.7, turbulence: 0.6 } },
      },
    ],
  },
});

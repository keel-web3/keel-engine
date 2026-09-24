// A building on fire: a bed of flames licking up off a breach (smaller and leaner than "fire", since a
// burning base has several), the odd flame dying into smoke, and embers lifting off the flames (a live
// sub-emit). One emitter, no continuous companion: pool.stop() puts it all out.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 20, shape: "disc", radius: 0.25, speed: [0, 0.25], up: [0.9, 1.8], priority: 2, budget: 30, reach: 4,
  particle: {
    life: [0.3, 0.6], size: [0.22, 0.38], sizeCurve: [1, 0.8, 0.3], light: [0.75, 1], lightCurve: [1.1, 0.85, 0.55], alpha: [1, 1, 0.6],
    ramp: "fire", sprite: "flame", drag: 1.5, gravity: -2, wind: 0.4, turbulence: 0.12, turbulenceScale: 0.8,
    sub: [
      {
        on: "death", chance: 0.15, count: [1, 1], inherit: 0.3,
        emit: { mode: "burst", count: [1, 1], shape: "point", speed: [0, 0.2], up: [0.4, 0.8], priority: 0, reach: 6, particle: { life: [0.8, 1.3], size: [0.2, 0.32], sizeCurve: [0.6, 1.4], light: [0.2, 0.4], alpha: [0.8, 0.5, 0], ramp: "smoke", sprite: "puff", soft: 0.5, shade: 0.5, drag: 0.8, gravity: -0.4, wind: 1, turbulence: 0.6 } },
      },
      {
        on: "live", rate: 1.5, inherit: 0.4,
        emit: { mode: "burst", count: [1, 1], shape: "point", speed: [0.1, 0.3], up: [0.6, 1.4], priority: 1, reach: 5, particle: { life: [0.9, 1.6], size: [0.04, 0.07], light: [0.7, 1], lightCurve: [1, 0.8, 0.5], alpha: [1, 1, 0.8, 0], ramp: "ember", drag: 0.8, gravity: -0.4, wind: 0.9, turbulence: 0.5 } },
      },
    ],
  },
});

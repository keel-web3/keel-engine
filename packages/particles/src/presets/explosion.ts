// An explosion: a flash of fire, then (its companions, each on its own budget) debris that arcs, bounces and
// trails smoke and kicks dust where it lands, a ball of smoke that grows and drifts, and sparks.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [6, 10], shape: "sphere", radius: 0.6, speed: [1, 3], priority: 2, reach: 8,
  particle: {
    life: [0.12, 0.25], size: [0.8, 1.4], sizeCurve: [0.7, 1.2, 0.9], light: [0.9, 1], lightCurve: [1, 0.85, 0.6], alpha: [1, 1, 0.4],
    ramp: "fire", shade: 0.3, drag: 4,
  },
  also: [
    // Debris: dark chunks, trailing smoke, kicking dust where they land.
    {
      mode: "burst", count: [10, 16], shape: "cone", dir: [0, 1, 0], angle: 1, speed: [4, 9], priority: 1, reach: 10,
      particle: {
        life: [1, 1.8], size: [0.1, 0.2], light: [0.2, 0.45], ramp: "smoke", gravity: 9.8, ground: "bounce", bounce: 0.3, friction: 0.5,
        sub: [
          { on: "live", rate: 18, inherit: 0.1, emit: { mode: "burst", count: [1, 1], shape: "point", speed: [0, 0.1], priority: 0, reach: 1, particle: { life: [0.3, 0.6], size: [0.12, 0.22], sizeCurve: [0.6, 1.4], light: [0.3, 0.5], alpha: [0.8, 0.4, 0], ramp: "smoke", soft: 0.5, drag: 2, gravity: -0.3, wind: 0.8 } } },
          { on: "ground", count: [2, 3], inherit: 0, emit: "dust-puff" },
        ],
      },
    },
    // Smoke: a ball of soft puffs, a beat after the flash, growing, rising, drifting (and thinning in a couple of seconds).
    {
      mode: "burst", count: [10, 16], delay: 0.08, shape: "sphere", radius: 1, speed: [0.5, 1.5], up: [0.5, 1.5], priority: 1, reach: 10,
      particle: {
        life: [1.2, 2.2], size: [0.6, 1], sizeCurve: [0.6, 1.2, 1.5], light: [0.35, 0.6], lightCurve: [1.1, 0.8, 0.7], alpha: [1, 0.85, 0.4, 0],
        ramp: "smoke", soft: 0.5, shade: 0.6, drag: 1.2, gravity: -0.6, wind: 0.8,
      },
    },
    // Sparks.
    {
      mode: "burst", count: [16, 24], shape: "sphere", radius: 0.3, speed: [5, 11], priority: 2, reach: 10,
      particle: { life: [0.3, 0.7], size: [0.05, 0.1], light: [0.8, 1], lightCurve: [1, 0.7], ramp: "spark", streak: 0.03, gravity: 9.8, drag: 0.8, ground: "bounce", bounce: 0.3 },
    },
  ],
});

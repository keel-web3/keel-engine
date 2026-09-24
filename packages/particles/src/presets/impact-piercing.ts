// A piercing hit (spines, needles, armour-piercing rounds): one or two long streaks glancing off -- pass the
// shot's direction as `dir` to throw them onward -- and a small puff where it went in.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [1, 2], shape: "cone", dir: [0, 1, 0], angle: 0.6, speed: [6, 10], priority: 2, reach: 2,
  particle: {
    life: [0.06, 0.12], size: [0.05, 0.07], light: [0.85, 1], lightCurve: [1, 0.75],
    ramp: "spark", streak: 0.05, gravity: 4, drag: 2,
  },
  also: [{
    mode: "burst", count: [2, 3], shape: "point", speed: [0.3, 0.8], up: [0.2, 0.5], priority: 1, reach: 1.5,
    particle: { life: [0.3, 0.5], size: [0.14, 0.24], sizeCurve: [0.5, 1.2, 1.4], light: [0.5, 0.75], alpha: [0.9, 0.6, 0], ramp: "dust", soft: 0.5, shade: 0.5, drag: 4, gravity: -0.2, wind: 0.5, turbulence: 0.35 },
  }],
});

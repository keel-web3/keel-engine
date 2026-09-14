// A blast hit (grenades, rockets, bile globs that burst): a small fireball, a few dark chips of debris
// that bounce, and a puff of smoke a beat after. An explosion's little brother.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [3, 5], shape: "sphere", radius: 0.2, speed: [0.5, 1.5], priority: 2, reach: 4,
  particle: {
    life: [0.1, 0.2], size: [0.4, 0.7], sizeCurve: [0.7, 1.2, 0.9], light: [0.85, 1], lightCurve: [1, 0.85, 0.6], alpha: [1, 1, 0.4],
    ramp: "fire", sprite: "puff", shade: 0.3, drag: 4,
  },
  also: [
    {
      mode: "burst", count: [5, 8], shape: "cone", dir: [0, 1, 0], angle: 1, speed: [2, 5], priority: 1, reach: 4,
      particle: { life: [0.6, 1.1], size: [0.06, 0.12], light: [0.15, 0.4], ramp: "metal", gravity: 9.8, ground: "bounce", bounce: 0.3, friction: 0.5 },
    },
    {
      mode: "burst", count: [3, 5], delay: 0.05, shape: "sphere", radius: 0.3, speed: [0.3, 0.8], up: [0.3, 0.7], priority: 1, reach: 4,
      particle: {
        life: [0.6, 1.1], size: [0.4, 0.7], sizeCurve: [0.6, 1.2, 1.5], light: [0.3, 0.55], alpha: [1, 0.8, 0.4, 0],
        ramp: "smoke", sprite: "puff", shade: 0.6, drag: 1.5, gravity: -0.4, wind: 0.8,
      },
    },
  ],
});

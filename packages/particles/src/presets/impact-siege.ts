// A siege hit (artillery, bombardment, a colossus' slam): a big one. A white-hot core over a fireball, heavy
// debris flung high that bounces and kicks dust where it lands, and a dark ball of smoke that rolls up and
// drifts. Scale it with the shell (`scale`).
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [8, 12], shape: "sphere", radius: 0.8, speed: [1.5, 3.5], priority: 2, reach: 12,
  particle: {
    life: [0.14, 0.26], size: [1, 1.6], sizeCurve: [0.7, 1.2, 0.9], light: [0.9, 1], lightCurve: [1, 0.85, 0.6], alpha: [1, 1, 0.4],
    ramp: "fire", sprite: "puff", shade: 0.3, drag: 4,
  },
  also: [
    // The white-hot core, over everything.
    {
      mode: "burst", count: [2, 3], shape: "sphere", radius: 0.3, speed: [0, 0.5], priority: 2, reach: 3,
      particle: { life: [0.05, 0.09], size: [1.2, 1.8], sizeCurve: [1, 1.2, 0.5], light: [0.95, 1], ramp: "flash", depthBias: 0.5 },
    },
    // Heavy debris.
    {
      mode: "burst", count: [14, 20], shape: "cone", dir: [0, 1, 0], angle: 1, speed: [5, 11], priority: 1, reach: 14,
      particle: {
        life: [1.2, 2], size: [0.12, 0.26], light: [0.12, 0.4], ramp: "metal", gravity: 9.8, ground: "bounce", bounce: 0.3, friction: 0.5,
        sub: [{ on: "ground", count: [1, 2], inherit: 0, emit: "dust-puff" }],
      },
    },
    // The smoke ball.
    {
      mode: "burst", count: [12, 18], delay: 0.06, shape: "sphere", radius: 1.2, speed: [0.5, 1.6], up: [0.6, 1.6], priority: 1, reach: 14,
      particle: {
        life: [1.5, 2.4], size: [0.8, 1.3], sizeCurve: [0.6, 1.2, 1.5], light: [0.2, 0.45], lightCurve: [1.1, 0.8, 0.75], alpha: [1, 0.9, 0.5, 0],
        ramp: "smoke", sprite: "puff", shade: 0.6, drag: 1.2, gravity: -0.6, wind: 0.8,
      },
    },
  ],
});

// A machine (or stone) body going down: a bright pop, a burst of sparks, a few plates flung and bouncing, and
// a short slump of soft dust and dark smoke. Over in about a second.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [1, 2], shape: "sphere", radius: 0.1, speed: [0, 0.2], offset: [0, 0.3, 0], priority: 2, reach: 3,
  particle: {
    life: [0.06, 0.1], size: [0.6, 0.9], sizeCurve: [1, 1.2, 0.4], light: [0.95, 1], ramp: "flash", depthBias: 0.3,
  },
  also: [
    {
      mode: "burst", count: [14, 20], shape: "sphere", radius: 0.2, speed: [3.5, 7], priority: 2, reach: 5,
      particle: { life: [0.25, 0.5], size: [0.05, 0.08], light: [0.8, 1], lightCurve: [1, 0.7], ramp: "spark", streak: 0.03, gravity: 9.8, drag: 0.8, ground: "bounce", bounce: 0.3 },
    },
    {
      mode: "burst", count: [5, 8], shape: "cone", dir: [0, 1, 0], angle: 0.9, speed: [2, 4.5], priority: 1, reach: 4,
      particle: { life: [0.9, 1.5], size: [0.08, 0.16], light: [0.2, 0.55], ramp: "metal", gravity: 9.8, ground: "bounce", bounce: 0.3, friction: 0.5 },
    },
    {
      mode: "burst", count: [5, 8], shape: "disc", radius: 0.4, speed: [0.8, 1.6], up: [0.2, 0.5], priority: 1, reach: 4,
      particle: { life: [0.5, 0.8], size: [0.25, 0.4], sizeCurve: [0.6, 1.2, 1.3], light: [0.5, 0.75], alpha: [1, 0.8, 0.4, 0], ramp: "dust", sprite: "puff", soft: 0.55, shade: 0.5, drag: 2.5, gravity: -0.15, wind: 0.5, turbulence: 0.35 },
    },
    {
      mode: "burst", count: [2, 3], delay: 0.05, shape: "sphere", radius: 0.2, speed: [0.2, 0.5], up: [0.4, 0.8], priority: 1, reach: 4,
      particle: { life: [0.6, 0.9], size: [0.25, 0.4], sizeCurve: [0.6, 1.2, 1.3], light: [0.15, 0.35], alpha: [0.9, 0.6, 0.2, 0], ramp: "smoke", sprite: "puff", soft: 0.55, shade: 0.5, drag: 1.2, gravity: -0.5, wind: 0.8, turbulence: 0.6 },
    },
  ],
});

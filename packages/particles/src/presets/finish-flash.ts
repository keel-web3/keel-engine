// A building completes: a white-hot flash at its heart, a bright pale ring bursting out and stopping, a
// second ring of pale glints lifting off, and only a whisper of dust. Scale it with the footprint (`scale`).
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [24, 30], shape: "ring", radius: 0.3, speed: [4, 6], priority: 2, reach: 5,
  particle: {
    life: [0.2, 0.32], size: [0.16, 0.26], light: [0.92, 1], lightCurve: [1, 0.95, 0.8], alpha: [1, 1, 0.8, 0],
    ramp: "flash", drag: 4.5, depthBias: 0.2,
  },
  also: [
    {
      mode: "burst", count: [2, 2], shape: "sphere", radius: 0.1, speed: [0, 0.1], offset: [0, 0.5, 0], priority: 2, reach: 2,
      particle: { life: [0.1, 0.18], size: [1.2, 1.6], sizeCurve: [0.8, 1.3, 0.4], light: [0.97, 1], ramp: "flash", depthBias: 0.4 },
    },
    {
      mode: "burst", count: [16, 20], shape: "ring", radius: 0.5, speed: [1.5, 2.2], up: [0.6, 1.2], priority: 2, reach: 4,
      particle: { life: [0.4, 0.6], size: [0.08, 0.12], light: [0.8, 1], lightCurve: [1, 1, 0.8], alpha: [1, 1, 0.6, 0], ramp: "snow", drag: 2, depthBias: 0.1 },
    },
    {
      mode: "burst", count: [4, 6], shape: "ring", radius: 0.8, speed: [0.8, 1.5], up: [0.1, 0.3], priority: 1, reach: 4,
      particle: { life: [0.4, 0.7], size: [0.25, 0.4], sizeCurve: [0.6, 1, 1.2], light: [0.7, 0.85], alpha: [0.8, 0.6, 0], ramp: "dust", sprite: "puff", soft: 0.6, shade: 0.4, drag: 3, gravity: -0.2, wind: 0.5 },
    },
  ],
});

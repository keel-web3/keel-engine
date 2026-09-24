// The aftermath of a building's destruction: a low roll of soft dust off the footprint, chunks of rubble that
// land and lie there, and a thin thread of smoke rising off the ruin for a few seconds. Scale it with the footprint.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [10, 14], shape: "disc", radius: 0.8, speed: [0.5, 1.5], up: [0.2, 0.6], priority: 1, reach: 6,
  particle: {
    life: [0.9, 1.5], size: [0.35, 0.6], sizeCurve: [0.6, 1.2, 1.4], light: [0.5, 0.75], lightCurve: [1, 0.9], alpha: [1, 0.8, 0.4, 0],
    ramp: "dust", sprite: "puff", soft: 0.55, shade: 0.5, drag: 1.8, gravity: -0.15, wind: 0.6, turbulence: 0.35,
  },
  also: [
    {
      mode: "burst", count: [10, 14], shape: "disc", radius: 1, speed: [0.5, 2], up: [1, 3], priority: 1, reach: 5,
      particle: { life: [4, 6], size: [0.12, 0.24], light: [0.15, 0.4], alpha: [1, 1, 1, 0.7, 0], ramp: "dust", gravity: 9.8, ground: "stick" },
    },
    // (A thin column, not a blanket: narrow, small puffs climbing steadily.)
    {
      mode: "continuous", rate: 2.5, duration: 5, shape: "disc", radius: 0.15, speed: [0, 0.08], up: [1, 1.4], priority: 1, budget: 8, reach: 8,
      particle: { life: [1.6, 2.4], size: [0.18, 0.3], sizeCurve: [0.6, 1.1, 1.4], light: [0.3, 0.5], alpha: [0.7, 0.55, 0.25, 0], ramp: "smoke", sprite: "puff", soft: 0.6, shade: 0.4, drag: 0.5, gravity: -0.35, wind: 0.6, turbulence: 0.6 },
    },
  ],
});

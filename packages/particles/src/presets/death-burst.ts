// An organic body bursting: a punchy pop of ichor mist, a spray of gibs flung up and out that land and lie
// there, and the splat ("ichor-splat") under it all. Short: the mist is gone in a third of a second.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [10, 14], shape: "cone", dir: [0, 1, 0], angle: 1.1, speed: [2.5, 5.5], up: [1.2, 2.4], priority: 2, reach: 5,
  particle: {
    life: [2.5, 4], size: [0.12, 0.24], light: [0.3, 0.65], alpha: [1, 1, 1, 0.7, 0],
    ramp: "ichor", shade: 0.3, gravity: 9.8, drag: 0.3, ground: "stick",
  },
  also: [
    {
      mode: "burst", count: [4, 6], shape: "sphere", radius: 0.25, speed: [0.8, 1.8], priority: 2, reach: 3,
      particle: { life: [0.18, 0.32], size: [0.3, 0.5], sizeCurve: [0.7, 1.3, 1.1], light: [0.55, 0.85], alpha: [1, 0.7, 0], ramp: "ichor", sprite: "puff", soft: 0.5, shade: 0.3, drag: 5 },
    },
    "ichor-splat",
  ],
});

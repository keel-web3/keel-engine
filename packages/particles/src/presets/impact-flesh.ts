// A hit on something alive: a small puff of ichor mist and a few droplets that stick. The game adds it on
// top of the damage class's impact when the target is organic.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [4, 7], shape: "cone", dir: [0, 1, 0], angle: 1.1, speed: [1, 2.5], up: [0.3, 0.8], priority: 1, reach: 2,
  particle: {
    life: [0.8, 1.4], size: [0.05, 0.1], light: [0.35, 0.8], alpha: [1, 1, 0.8, 0],
    ramp: "ichor", gravity: 9.8, drag: 0.5, ground: "stick",
  },
  also: [{
    mode: "burst", count: [1, 2], shape: "sphere", radius: 0.1, speed: [0.2, 0.6], priority: 1, reach: 1,
    particle: { life: [0.2, 0.35], size: [0.18, 0.28], sizeCurve: [0.6, 1.3], light: [0.45, 0.7], alpha: [0.9, 0.5, 0], ramp: "ichor", sprite: "puff", drag: 4 },
  }],
});

// A muzzle flash: a few frames of fire thrown along the barrel (emit it on the gun's socket; the cone is the
// socket's +z), drawn over its own gun, and a puff of smoke hanging after.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "burst", count: [5, 8], shape: "cone", dir: [0, 0, 1], angle: 0.35, offset: [0, 0, 0.1],
  speed: [4, 9], priority: 2, reach: 2,
  particle: {
    life: [0.04, 0.09], size: [0.18, 0.32], sizeCurve: [1.2, 0.6], light: [0.85, 1],
    ramp: "flash", sprite: "flame", streak: 0.015, drag: 8, depthBias: 0.3,
  },
  also: [{
    mode: "burst", count: [2, 3], shape: "cone", dir: [0, 0, 1], angle: 0.5, offset: [0, 0, 0.25],
    speed: [0.4, 1], priority: 1, reach: 2,
    particle: { life: [0.4, 0.7], size: [0.15, 0.25], sizeCurve: [0.6, 1.3], light: [0.5, 0.7], alpha: [0.8, 0.6, 0], ramp: "smoke", soft: 0.5, shade: 0.4, drag: 3, gravity: -0.3, wind: 0.8 },
  }],
});

// A badly damaged unit trailing smoke: a thin trail of small soft puffs laid per metre moved, from a little
// above the anchor (the offset scales with the emit's `scale`), gone within a second -- it marks the unit
// without smothering the fight. Emit it on the unit ({ unit }) so it follows; a world-point one follows pool.move().
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "trail", perMetre: 2.2, shape: "disc", radius: 0.08, offset: [0, 0.7, 0], speed: [0, 0.1], up: [0.3, 0.6], inherit: -0.1, priority: 1, budget: 12, reach: 4,
  particle: {
    life: [0.6, 1.1], size: [0.16, 0.26], sizeCurve: [0.6, 1.2, 1.5], light: [0.3, 0.5], lightCurve: [1, 1.2], alpha: [0.85, 0.65, 0.3, 0],
    ramp: "smoke", sprite: "puff", soft: 0.45, shade: 0.4, drag: 1.2, gravity: -0.35, wind: 0.8, turbulence: 0.6,
  },
});

// Snow over the whole picture: flakes drifting down, turning, carried by the wind, settling and fading.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", density: 0.12, shape: "area", area: "view", offset: [0, 8, 0],
  speed: [0.1, 0.4], velocity: [0, -1.2, 0], priority: 0, reach: 0,
  particle: {
    life: [7, 9], size: [0.05, 0.1], light: [0.75, 1], alpha: [1, 1, 1, 1, 0.6, 0],
    ramp: "snow", drag: 0.8, wind: 1, turbulence: 0.8, ground: "stick",
  },
});

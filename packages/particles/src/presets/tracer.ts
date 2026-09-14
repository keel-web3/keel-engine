// A tracer (also "tracer-kinetic"): a short pale-yellow streak for a shot in flight -- a bullet, a slug. Two
// ways to drive it, both with the same recipe (and the same for every "tracer-*"):
//   - each tick at the projectile, with its velocity:  pool.emit("tracer", x, y, z, { velocity: [vx, vy, vz] })
//     -- a stream for 0.1 s (so any frame step up to the game's 0.1 s cap throws some), its specks born over
//     that tenth at the spot and flying on at the shot's speed: the next stretch of its path, streaked.
//   - as a trail on a moving anchor: pool.emit("tracer", x, y, z, { unit: shotId, duration: Infinity })
//     (or keep the handle, pool.move() it each tick, pool.stop() it on impact) -- specks laid along the path
//     moved, keeping `inherit` of its speed, so they lag into a tail behind the head.
import { defineParticleRecipe } from "../recipe.ts";

export default defineParticleRecipe({
  mode: "continuous", rate: 60, duration: 0.1, shape: "point", speed: [0, 0.2], inherit: 0.6, priority: 2, budget: 12, reach: 5,
  particle: {
    life: [0.05, 0.09], size: [0.05, 0.07], light: [0.85, 1], lightCurve: [1, 0.8],
    ramp: "flash", streak: 0.03, depthBias: 0.1,
  },
});

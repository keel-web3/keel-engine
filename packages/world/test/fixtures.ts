// The test level both worlds build (this repo's and the proof of concept's):
// a floor, a bench, a crate, two animals and a person, a brain, dust on
// landing and a scripted player -- the proof of concept's tests/world.test.mjs.

import { createWorld } from "../src/index.ts";
import type { Gen, World, WorldEntity, WorldOptions } from "../src/index.ts";

// A small level: a floor, a bench, a crate, two animals and a person, each by id.
export function level(g: Gen): void {
  g.place("pad", { id: "floor", tags: ["ground"], ctx: { w: 16, d: 16, h: 0.3, lip: false }, on: [0] });
  g.place("bench", { id: "bench-1", tags: ["bench"], pos: [2, 0, 1], on: "auto" });
  g.place("crate", { id: "crate-1", pos: [-3, 0, 2], on: "auto" });
  g.choose("material", ["oak", "teak", "paint"], { thing: { id: "bench-1", tags: ["bench"] } });
  const n = g.int("animals", 2, 2);
  for (let i = 1; i <= n; i += 1) g.spawn({ id: `animal-${i}`, kind: "animal", tags: ["animal"], pos: [i * 1.5 - 3, 0.6, -2], yaw: i, brain: "roam" });
  g.spawn({ id: "hero", kind: "humanoid", tags: ["hero"], pos: [0, 0.6, 0], player: true });
}
// A brain with its own stream: turns and walks.
export function roam(w: World, ent: WorldEntity): { move: [number, number] } {
  const S = w.rng(`mind:${ent.id}`);
  const m = ent.mind as { dir?: number };
  if (!m.dir || S.chance(0.01)) m.dir = S.between(-Math.PI, Math.PI);
  return { move: [Math.sin(m.dir) * 0.5, Math.cos(m.dir) * 0.5] };
}
export const MATERIALS = ["wall", "floor", "metal", "dark", "water", "sky", "oak", "teak", "paint"].map((name) => ({ name, ramp: name }));
export function makeWorld(opts: WorldOptions = {}, make: (o: WorldOptions) => World = createWorld): World {
  const w = make({ seed: "42", width: 64, height: 64, materials: MATERIALS, ...opts });
  w.brain("roam", roam);
  w.on("landed", (e, world) => world.particles.emit("dust", e.at!, { count: 3 }));
  // A scripted player: walks in a square, jumps now and then (the same every run).
  w.drive((world) => { const k = Math.floor(world.time / 1.5) % 4; return { move: ([[1, 0], [0, 1], [-1, 0], [0, -1]] as const)[k]!, jump: world.steps % 200 === 0, hold: true }; });
  w.generate(level);
  return w;
}


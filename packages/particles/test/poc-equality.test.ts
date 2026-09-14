// The TypeScript particles against the JavaScript proof of concept (imported
// from its repo, never written to): src/particles/particles.js (the pool,
// the draws, the step, list()) and src/world/particles.js (the same, as plain
// data: save/load), step by step, bit for bit, over many seeds.

import { test } from "node:test";
import * as tP from "../src/particles.ts";
import type { EmitOptions, ParticleState, Particles, ParticlesOptions, Recipes } from "../src/particles.ts";
import { counter, hasPoc, poc, rand, skip } from "./reference.ts";

interface PocParticles { createParticles(max?: number): Omit<Particles, "save" | "load" | "clear" | "max"> }
interface PocWorldParticles { createWorldParticles(o?: { max?: number; recipes?: Recipes; stream?: ParticlesOptions["stream"] }): Particles; baseRecipes(): Recipes }
const ref = hasPoc ? await Promise.all([poc<PocParticles>("src/particles/particles.js"), poc<PocWorldParticles>("src/world/particles.js")]) : null;
const [jP, jW] = ref ?? ([] as unknown as NonNullable<typeof ref>);
const { same, exact, summary } = counter();

const KINDS = ["dust", "spark", "splash", "mote"];
type R = () => number;
const num = (r: R, a: number, b: number): number => a + (b - a) * r();

/** A scripted run: emits (every kind, every option), steps of varying dt, the same on every pool. */
function script(seed: number, frames: number): ((ps: { emit: Particles["emit"]; step: Particles["step"] }, S: { f(): number }) => void)[] {
  const r = rand(seed);
  return Array.from({ length: frames }, () => {
    const emits = Array.from({ length: r() < 0.4 ? Math.floor(num(r, 1, 4)) : 0 }, () => {
      const kind = KINDS[Math.floor(r() * KINDS.length)]!;
      const at: [number, number, number] = [num(r, -5, 5), num(r, 0, 3), num(r, -5, 5)];
      const opts: Record<string, unknown> = {};
      if (r() < 0.7) opts["count"] = Math.floor(num(r, 0, 12));
      if (r() < 0.5) opts["vel"] = [num(r, -3, 3), num(r, -1, 4), num(r, -3, 3)];
      if (r() < 0.3) opts["spread"] = num(r, 0, 3);
      if (r() < 0.2) opts["ramp"] = "neon";
      return { kind, at, opts };
    });
    const dt = r() < 0.1 ? num(r, 0, 0.3) : 1 / 60;
    return (ps, S) => { for (const e of emits) ps.emit(e.kind, e.at, { ...e.opts, S } as EmitOptions); ps.step(dt); };
  });
}

test("particles.js: the same pool, draw for draw and step for step, over 150 seeds", { skip }, () => {
  same("recipes", tP.RECIPES, jP.createParticles(0).recipes);
  same("recipes", tP.baseRecipes(), jW.baseRecipes());
  for (let seed = 1; seed <= 150; seed += 1) {
    const max = seed % 5 === 0 ? 20 : 600;
    const a = tP.createParticles(max);
    const b = jP.createParticles(max);
    const sa = { f: rand(seed * 977) };
    const sb = { f: rand(seed * 977) };
    for (const f of script(seed, 120)) {
      f(a, sa);
      f(b, sb);
      exact("particles.js counts", a.count, b.count);
      same("particles.js lists (per frame)", a.list(), b.list());
    }
  }
});

test("world/particles.js: the same pool and the same snapshots (save/load), over 100 seeds", { skip }, () => {
  for (let seed = 1; seed <= 100; seed += 1) {
    const sa = { f: rand(seed * 31) };
    const sb = { f: rand(seed * 31) };
    const a = tP.createParticles(400, { stream: () => sa });
    const b = jW.createWorldParticles({ max: 400, stream: () => sb });
    const run = script(seed + 9000, 120);
    let snap: [ParticleState[], ParticleState[]] | null = null;
    for (let i = 0; i < run.length; i += 1) {
      run[i]!(a, sa);
      run[i]!(b, sb);
      same("world lists (per frame)", a.list(0.75), b.list(0.75));
      if (i === 40) { snap = [a.save(), b.save()]; same("world snapshots", snap[0], snap[1]); }
    }
    same("world snapshots", a.save(), b.save());
    // Back to frame 40 on both, and on again: the same as the first time through.
    if (snap) {
      a.load(snap[0]); b.load(snap[1]);
      for (let i = 41; i < run.length; i += 1) { run[i]!(a, sa); run[i]!(b, sb); }
      same("world snapshots (reloaded, replayed)", a.save(), b.save());
      a.clear(); b.clear();
      exact("world counts", a.count, b.count);
    }
  }
});

test("summary", { skip }, () => {
  console.log(summary("particles vs the proof of concept (all identical)"));
});

// The smart pool: no allocation after warm-up, budgets and priorities, LOD
// and culling, determinism, save/load, sub-emitters, sockets and velocity
// inheritance, the closed-form motion and the ground, the change log the
// renderer reads, and the preset library.
import { test } from "node:test";
import assert from "node:assert/strict";
import { Session } from "node:inspector/promises";
import { createRoll, stream } from "@keel-engine/core";
import { pixelView } from "@keel-engine/bake";
import {
  CURVE_SAMPLES, NO_EMITTER, PARTICLE_RAMPS, PRESETS, STYLE_WIDTH, createParticlePool, defineParticleRecipe, frameFromYaw, frameToWorld, motionAt, particlePalette,
  particleSpriteAtlas, recipeProblems, sampleCurve,
} from "../src/index.ts";
import type { EmitterRecipe, ParticleHost, ParticlePool } from "../src/index.ts";

const dt = 1 / 120;
interface SampleNode { callFrame: { url: string; functionName: string }; selfSize: number; children: SampleNode[] }
const steps = (pool: ParticlePool, n: number, each?: (s: number) => void) => { for (let s = 0; s < n; s += 1) { each?.(s); pool.step(dt); } };
const puff = defineParticleRecipe({ mode: "burst", count: [10, 10], shape: "point", speed: [1, 1], priority: 1, particle: { life: [1, 1], size: [0.3, 0.3], light: [0.5, 0.5], ramp: "dust" } });
const steady = (priority: 0 | 1 | 2 | 3, rate = 600): EmitterRecipe => ({ mode: "continuous", rate, shape: "sphere", speed: [0.5, 1], priority, particle: { life: [5, 5], size: [0.3, 0.3], light: [0.5, 0.5], ramp: "dust" } });
/** The live slots. */
const live = (pool: ParticlePool): number[] => { const out: number[] = []; pool.liveSlots(out); return out; };
/** Where each live particle is now, its velocity, its style, random byte and scale -- as sorted rows (slot-order free). */
const rows = (pool: ParticlePool, only?: (slot: number) => boolean) => {
  const o = [0, 0, 0, 0, 0, 0];
  return live(pool).filter((s) => !only || only(s)).map((s) => { pool.sample(s, o); return [...o, pool.slots.style[s], pool.slots.rnd[s], pool.slots.lod[s]].join(","); }).sort();
};

test("the pool never allocates after warm-up: no typed array grows, and V8's allocation sampler finds nothing made per particle", async () => {
  const units = 200;
  const ux = new Float64Array(units);
  // (The host writes its frames itself: the test's own code shouldn't be what allocates either.)
  const host: ParticleHost = {
    locate(u, socket, out) {
      out[0] = ux[u]!; out[1] = socket ? 1 : 0; out[2] = u * 0.5;
      out[3] = 1; out[4] = 0; out[5] = 0; out[6] = 0; out[7] = 1; out[8] = 0; out[9] = 0; out[10] = 0; out[11] = 1;
      return true;
    },
  };
  const pool = createParticlePool({ capacity: 20000, emitters: 2048, recipes: PRESETS, host, seed: 9 });
  pool.setView(pixelView({ center: [50, 0, 100], yaw: 0.3, pitch: 0.6, pixelsPerMetre: 12, width: 960, height: 540 }));
  for (let u = 0; u < units; u += 1) pool.emit("footstep-dust", 0, 0, 0, { unit: u });
  const names = Object.keys(PRESETS);
  const opts = { unit: 3, socket: "hand.R" };
  const changes = new Int32Array(pool.capacity);
  const run = (n: number) => steps(pool, n, (s) => {
    for (let u = 0; u < units; u += 1) ux[u] = (ux[u]! + 0.02) % 100; // (marching, and staying in view)
    if (s % 7 === 0) pool.emit(names[s % names.length]!, (s * 13) % 100, 0, (s * 7) % 200);
    if (s % 11 === 0) pool.emit("muzzle-flash", 0, 0, 0, opts);
    pool.takeChanges(changes); // (as the renderer does, every frame)
  });
  // (Warm-up: the JIT, every recipe's first spawn -- long enough that each preset has been emitted 25 times, since
  // the library grew to ~46 of them: a path first taken inside the measured window deopts and boxes.)
  run(Math.max(1500, names.length * 7 * 25));
  const growths = pool.stats.growths;
  const session = new Session();
  session.connect();
  // Per function in pool.ts: the per-particle work (spawning, events, the ground, the motion, sub-emits, the
  // slot heap, the change log) allocates nothing at all; emitter-level work (emit(), an emitter's step) may box a
  // few doubles while V8 still runs it in the interpreter -- a cold path, bounded, and counted here. (Up to five
  // windows of 2000 steps: a JIT compile finishing inside a window -- on a busy machine, or this test's own loop
  // being recompiled -- lands a lump of ~8-25 KB on whatever function is running then; a clean window is the proof.)
  const HOT = ["event", "spawn", "subEmit", "subCount", "freeSlot", "takeSlot", "startSegment", "groundHit", "sampleSlot", "motionCore", "schedule", "logChange", "stepPool", "h30", "lodFor", "importance", "takeChanges"];
  let sites = new Map<string, number>();
  let spawned = 0;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    await session.post("HeapProfiler.startSampling", { samplingInterval: 64, includeObjectsCollectedByMajorGC: true, includeObjectsCollectedByMinorGC: true });
    const before = pool.stats.spawned;
    run(2000);
    spawned = pool.stats.spawned - before;
    const { profile } = (await session.post("HeapProfiler.stopSampling")) as { profile: { head: SampleNode } };
    const found = new Map<string, number>();
    const walk = (n: SampleNode) => { if (n.callFrame.url.endsWith("/particles/src/pool.ts")) found.set(n.callFrame.functionName, (found.get(n.callFrame.functionName) ?? 0) + n.selfSize); n.children.forEach(walk); };
    walk(profile.head);
    sites = found;
    if (HOT.every((h) => !found.get(h))) break;
  }
  session.disconnect();
  assert.ok(pool.count > 500 && spawned > 10000, `a busy pool (${pool.count} live, ${spawned} spawned)`);
  assert.equal(pool.stats.growths, growths, "no typed array made after creation");
  for (const hot of HOT) assert.equal(sites.get(hot) ?? 0, 0, `${hot} allocated ${sites.get(hot)} bytes`);
  let total = 0;
  for (const b of sites.values()) total += b;
  assert.ok(total / 2000 < 64, `pool.ts allocated ${total} bytes (sampled) over 2000 busy steps: ${JSON.stringify([...sites])}`);
});

test("budgets: past a reserve an importance stops spawning, higher ones still spawn; an emitter keeps to its own budget", () => {
  const pool = createParticlePool({ capacity: 1000, seed: 1, recipes: { low: steady(0), mid: steady(1), high: steady(2), crit: steady(3) }, pressure: false });
  pool.emit("low", 0, 0, 0);
  steps(pool, 240);
  assert.equal(pool.count, 550, "ambient stops at 55%");
  assert.ok(pool.stats.budget > 0);
  pool.emit("high", 0, 0, 0);
  steps(pool, 120);
  assert.equal(pool.count, 950, "important fills to 95%");
  pool.emit("crit", 0, 0, 0);
  steps(pool, 60);
  assert.equal(pool.count, 1000, "critical takes the last of it -- and never past capacity");
  steps(pool, 60);
  assert.equal(pool.count, 1000);
  assert.equal(pool.highWater, 1000);
  // Per emitter.
  const capped = createParticlePool({ capacity: 1000, seed: 1, recipes: { c: { ...steady(1), budget: 25 } } });
  capped.emit("c", 0, 0, 0);
  capped.emit("c", 5, 0, 0);
  steps(capped, 120);
  assert.equal(capped.count, 50);
  assert.ok(capped.stats.emitterBudget > 0);
  // Emitter slots run out without allocating: emit says -1.
  const few = createParticlePool({ capacity: 100, emitters: 2, recipes: { puff } });
  assert.ok(few.emit("puff", 0, 0, 0) >= 0 && few.emit("puff", 0, 0, 0) >= 0);
  assert.equal(few.emit("puff", 0, 0, 0), -1);
  assert.equal(few.stats.noEmitter, 1);
  steps(few, 130); // (the bursts' particles die, their slots come back)
  assert.equal(few.count, 0);
  assert.equal(few.highWater, 0);
  assert.ok(few.emit("puff", 0, 0, 0) >= 0);
});

test("far from the view's centre an emitter counts one importance less; off the picture it spawns nothing", () => {
  const pool = createParticlePool({ capacity: 1000, seed: 3, recipes: { mid: steady(1, 1200) }, pressure: false });
  pool.setViewRect(0, 0, 100, 100, 8);
  pool.emit("mid", 95, 0, 95); // (in the picture, far from its centre: counts as ambient)
  steps(pool, 120);
  assert.equal(pool.count, 550);
  const off = createParticlePool({ capacity: 1000, seed: 3, recipes: { mid: steady(1) } });
  off.setViewRect(0, 0, 100, 100, 8);
  off.emit("mid", 300, 0, 300);
  steps(off, 60);
  assert.equal(off.count, 0);
  assert.ok(off.stats.culled > 0);
  const burst = createParticlePool({ capacity: 1000, seed: 3, recipes: { puff } });
  burst.setViewRect(0, 0, 100, 100, 8);
  burst.emit("puff", -50, 0, 50);
  burst.step(dt);
  assert.equal(burst.count, 0, "an explosion off the picture throws nothing");
  assert.equal(burst.emitters, 0, "and its emitter is free again");
});

test("LOD: zoomed out, fewer and bigger (the same coverage); under pressure too", () => {
  const specks = { s: { ...steady(2, 2400), particle: { ...steady(2).particle, size: [0.1, 0.1] as const } } };
  const at = (k: number) => {
    const pool = createParticlePool({ capacity: 100000, seed: 5, recipes: specks, pressure: false });
    pool.setViewRect(-50, -50, 50, 50, k);
    pool.emit("s", 0, 0, 0);
    steps(pool, 120);
    let area = 0;
    for (const s of live(pool)) area += (0.1 * (pool.slots.lod[s]! / 16)) ** 2;
    return { n: pool.count, scale: pool.slots.lod[0]! / 16, area };
  };
  const near = at(30); // 3 px a speck: full detail
  const far = at(5); // half a pixel: thinned, grown
  assert.equal(near.scale, 1);
  assert.equal(near.n, 2400);
  assert.equal(far.scale, 3);
  assert.ok(Math.abs(far.n - 2400 / 9) <= 2, `1/m² of them (${far.n})`);
  assert.ok(Math.abs(far.area / near.area - 1) < 0.02, "the same area covered");
  // Pressure: filling toward a reserve, an emitter thins and grows.
  const busy = createParticlePool({ capacity: 1000, seed: 5, recipes: { m: steady(1) } });
  busy.emit("m", 0, 0, 0);
  steps(busy, 90);
  assert.ok(Math.max(...live(busy).map((s) => busy.slots.lod[s]!)) > 16, "late particles grow as the pool fills");
  assert.ok(busy.stats.lod > 0);
  assert.equal(createParticlePool({ capacity: 10, minPixels: 0, pressure: false, recipes: specks }).stats.lod, 0);
});

test("deterministic: the same seed plays the same; another seed doesn't; an emitter's particles don't depend on the others", () => {
  const play = (seed: number | { f(): number }, extra: boolean) => {
    const pool = createParticlePool({ capacity: 30000, seed, recipes: PRESETS });
    pool.wind.set([1, 0, 0.5]);
    const a = pool.emit("fire", 0, 0, 0);
    if (extra) { pool.emit("explosion", 3, 0, 3); pool.emit("rain", 0, 0, 0); }
    steps(pool, 200);
    return { all: rows(pool), mine: rows(pool, (s) => pool.slots.owner[s] === (a & 0xffff)) };
  };
  assert.deepEqual(play(7, true).all, play(7, true).all);
  assert.notDeepEqual(play(7, true).all, play(8, true).all);
  assert.deepEqual(play(7, false).mine, play(7, true).mine, "fire's particles are the same with or without an explosion and rain beside it");
  const S = () => stream(createRoll("0xabc"), 4);
  assert.deepEqual(play(S(), true).all, play(S(), true).all, "seeded from core's streams");
});

test("save / load: a snapshot mid-run, loaded into a fresh pool, plays on identically (and survives JSON as plain arrays)", () => {
  const units = 30;
  let x = 0;
  const host: ParticleHost = { locate: (u, _s, out) => { frameFromYaw(u * 2 + x, 0, u, u * 0.1, out); return true; } };
  const make = () => createParticlePool({ capacity: 20000, emitters: 256, seed: 11, recipes: PRESETS, host });
  const a = make();
  for (let u = 0; u < units; u += 1) a.emit("footstep-dust", 0, 0, 0, { unit: u });
  const script = (p: ParticlePool, s: number) => { if (s % 25 === 0) p.emit(s % 50 ? "explosion" : "spark-shower", s % 17, 0, s % 13, { duration: 1 }); };
  steps(a, 150, (s) => { x = s * 0.02; script(a, s); });
  const snap = a.save();
  const json = JSON.parse(JSON.stringify(snap, (_k, v: unknown) => (ArrayBuffer.isView(v) ? Array.from(v as Float64Array) : v))) as typeof snap;
  const b = make();
  b.load(json);
  assert.equal(b.count, a.count);
  assert.equal(b.highWater, a.highWater);
  assert.deepEqual(rows(b), rows(a));
  const x0 = x;
  steps(a, 200, (s) => { x = x0 + s * 0.02; script(a, s + 150); });
  steps(b, 200, (s) => { x = x0 + s * 0.02; script(b, s + 150); });
  assert.deepEqual(rows(b), rows(a), "the same particles 200 steps on");
  assert.deepEqual(live(b), live(a), "in the same slots");
  assert.equal(b.emitters, a.emitters);
  assert.throws(() => createParticlePool({ capacity: 20000, emitters: 256, seed: 12, recipes: PRESETS }).load(snap), /another seed/);
  assert.throws(() => createParticlePool({ capacity: 20000, emitters: 256, seed: 11, recipes: { puff } }).load(snap), /recipes/);
  a.clear();
  assert.equal(a.count, 0);
  assert.equal(a.emitters, 0);
  assert.equal(a.highWater, 0);
});

test("sub-emitters: a spark dying throws smoke, debris landing throws dust, debris in flight trails smoke -- all pooled", () => {
  const pool = createParticlePool({ capacity: 20000, seed: 2, recipes: PRESETS });
  const smoke = pool.recipeId("spark-shower#sub0");
  assert.ok(smoke > 0);
  pool.emit("spark-shower", 0, 0, 0, { duration: 0.5 });
  let sawSmoke = 0;
  steps(pool, 200, () => { for (const s of live(pool)) if (pool.slots.style[s] === smoke) sawSmoke += 1; });
  assert.ok(sawSmoke > 0 && pool.stats.sub > 0, "sparks die into smoke");
  const boom = createParticlePool({ capacity: 20000, seed: 2, recipes: PRESETS });
  const dust = boom.recipeId("dust-puff");
  const trail = boom.recipeId("explosion#also0#sub0");
  boom.emit("explosion", 0, 0, 0);
  const seen = new Set<number>();
  const o = [0, 0, 0, 0, 0, 0];
  let dustBorn = 0;
  steps(boom, 400, () => {
    for (const s of live(boom)) {
      seen.add(boom.slots.style[s]!);
      // (A sub-emit is born where its parent is at that moment: the dust from debris starts on the ground.)
      if (boom.slots.style[s] === dust) { assert.equal(boom.slots.p0[s * 3 + 1], 0); dustBorn += 1; }
    }
  });
  assert.ok(dustBorn > 0 && seen.has(dust), "debris kicks dust where it lands");
  assert.ok(boom.stats.bounced > 0, "debris bounces");
  assert.ok(seen.has(trail), "debris trails smoke");
  for (const n of ["explosion", "explosion#also0", "explosion#also1", "explosion#also2"]) assert.ok(seen.has(boom.recipeId(n)), n);
  // Ground: blood sticks (and lies on the ground), rain dies there.
  const splat = createParticlePool({ capacity: 2000, seed: 4, recipes: PRESETS });
  splat.emit("blood-splat", 0, 1, 0);
  steps(splat, 240);
  assert.ok(splat.count > 0);
  for (const s of live(splat)) { splat.sample(s, o); assert.ok(Math.abs(o[1]!) < 1e-4, `on the ground (${o[1]})`); assert.deepEqual(o.slice(3), [0, 0, 0]); }
  assert.ok(live(splat).every((s) => splat.slots.owner[s] !== NO_EMITTER), "a burst's own particles keep their emitter");
  const rain = createParticlePool({ capacity: 20000, seed: 4, recipes: PRESETS });
  rain.setViewRect(-10, -10, 10, 10, 24);
  rain.emit("rain", 0, 0, 0);
  steps(rain, 300);
  const splash = rain.recipeId("rain#sub0");
  for (const s of live(rain)) { rain.sample(s, o); if (rain.slots.style[s] !== splash) assert.ok(o[1]! > -1e-3, "no raindrop below the ground"); }
  assert.ok(live(rain).some((s) => rain.slots.style[s] === splash), "drops splash where they land");
});

test("the closed-form motion matches the equation it solves (a fine numerical integration), and freezes where it stops", () => {
  // u = vx + i·vz: u' = (-d + i·c)(u - u∞); vy' = -d(vy - vinf.y) (gravity folded into vinf.y), or -g without drag.
  const cases: [number, number, number, [number, number, number], [number, number, number]][] = [
    [0, 0, 9.8, [1, 5, -2], [0, 0, 0]], [3, 0, -0.4, [0.5, 1, 0.3], [2, 0.3, 1]], [0.8, 1.5, -0.4, [0.2, 2, 0.1], [0.9, 0, 0.4]], [0, 3, 0, [1, 0.8, 0], [0, 0, 0]], [0.5, 0, 9.8, [3, 6, 1], [1, 0, 0]],
  ];
  const out = [0, 0, 0, 0, 0, 0];
  for (const [d, c, g, v0, w] of cases) {
    // The drift velocity as the pool makes it: the wind through the drag and the curl, gravity through the drag.
    const k = d / (d * d + c * c || 1);
    const vinf: [number, number, number] = d > 0 ? [k * (w[0] * d - w[2] * c), w[1] - g / d, k * (w[0] * c + w[2] * d)] : [0, 0, 0];
    const p = [0, 10, 0];
    const v = [...v0];
    const h = 1e-5;
    for (let t = 0; t < 1.5 - 1e-9; t += h) {
      const ur = v[0]! - vinf[0], ui = v[2]! - vinf[2];
      const dur = -d * ur - c * ui, dui = c * ur - d * ui;
      const dvy = d > 0 ? -d * (v[1]! - vinf[1]) : -g;
      p[0] = p[0]! + v[0]! * h; p[1] = p[1]! + v[1]! * h; p[2] = p[2]! + v[2]! * h;
      v[0] = v[0]! + dur * h; v[2] = v[2]! + dui * h; v[1] = v[1]! + dvy * h;
    }
    motionAt([0, 10, 0], v0, vinf, d, c, g, 1.5, 1e9, out);
    for (let q = 0; q < 3; q += 1) assert.ok(Math.abs(out[q]! - p[q]!) < 1e-3, `d ${d} c ${c}: position ${out.slice(0, 3)} vs ${p}`);
    for (let q = 0; q < 3; q += 1) assert.ok(Math.abs(out[3 + q]! - v[q]!) < 1e-3, `d ${d} c ${c}: velocity ${out.slice(3)} vs ${v}`);
  }
  // Frozen past tStop: where it was at tStop, not moving.
  const at = [0, 0, 0, 0, 0, 0];
  motionAt([0, 1, 0], [1, 2, 0], [0, 0, 0], 0, 0, 9.8, 0.3, 1e9, at);
  motionAt([0, 1, 0], [1, 2, 0], [0, 0, 0], 0, 0, 9.8, 5, 0.3, out);
  assert.deepEqual(out.slice(0, 3), at.slice(0, 3));
  assert.deepEqual(out.slice(3), [0, 0, 0]);
});

test("the change log: births and bounces are handed over once; a clear or a load hands over everything", () => {
  const pool = createParticlePool({ capacity: 1000, seed: 1, recipes: PRESETS });
  const ch = new Int32Array(1000);
  assert.equal(pool.takeChanges(ch), -1, "a new pool: everything");
  pool.emit("explosion", 0, 0, 0);
  pool.step(dt);
  const n = pool.takeChanges(ch);
  assert.ok(n > 0 && Array.from(ch.subarray(0, n)).every((s) => pool.isLive(s)), "the newborn slots");
  assert.equal(pool.takeChanges(ch), 0, "taken once");
  steps(pool, 200);
  assert.ok(pool.stats.bounced > 0 && pool.takeChanges(ch) > 0);
  pool.clear();
  assert.equal(pool.takeChanges(ch), -1);
});

test("sockets: the host's frame places the offset and turns the cone; velocity is inherited from the anchor's motion", () => {
  // A unit at (10, 0, 5) facing +x (yaw π/2): its local +z is world +x.
  const f = frameFromYaw(10, 0, 5, Math.PI / 2, new Float64Array(12));
  const out = [0, 0, 0, 0, 0, 0];
  frameToWorld(f, 0.3, 1.2, 0.5, out);
  assert.deepEqual(out.slice(0, 3).map((v) => +v.toFixed(9)), [10.5, 1.2, 4.7], "local (0.3 right, 1.2 up, 0.5 ahead) -> world");
  // A gun socket: the muzzle flash's cone (+z in the socket frame) points along the unit's heading.
  let x = 0;
  const host: ParticleHost = { locate: (_u, socket, o) => { frameFromYaw(x, socket === "hand.R" ? 1.2 : 0, 0, Math.PI / 2, o); return true; } };
  const shot = defineParticleRecipe({ mode: "burst", count: [50, 50], shape: "cone", dir: [0, 0, 1], angle: 0.2, offset: [0, 0, 0.5], speed: [5, 5], particle: { life: [1, 1], size: [0.1, 0.1], light: [1, 1], ramp: "flash" } });
  const pool = createParticlePool({ capacity: 100, seed: 1, host, recipes: { shot } });
  pool.emit("shot", 0, 0, 0, { unit: 0, socket: "hand.R" });
  pool.step(dt);
  for (const s of live(pool)) {
    pool.sample(s, out, 0, pool.slots.tBirth[s]);
    assert.ok(Math.abs(out[0]! - 0.5) < 1e-6 && Math.abs(out[1]! - 1.2) < 1e-6, "at the socket, offset ahead");
    assert.ok(out[3]! > 4.8, "thrown along the unit's heading (+x)");
  }
  // Inheritance: a stream on a unit moving 3 m/s along +x throws particles carrying `inherit` of that.
  const carried = defineParticleRecipe({ mode: "continuous", rate: 240, shape: "point", speed: [0, 0], inherit: 0.5, particle: { life: [1, 1], size: [0.1, 0.1], light: [1, 1], ramp: "dust" } });
  const moving = createParticlePool({ capacity: 1000, seed: 1, host, recipes: { carried } });
  moving.emit("carried", 0, 0, 0, { unit: 0 });
  steps(moving, 30, () => { x += 3 * dt; });
  assert.ok(moving.count > 20);
  // (All but the first step's two: an anchor's velocity needs a step to measure.)
  let carriedOn = 0;
  for (const s of live(moving)) { moving.sample(s, out); if (Math.abs(out[3]! - 1.5) < 1e-3) carriedOn += 1; }
  assert.equal(carriedOn, moving.count - 2);
  // A stream's particles are born spread over the step (not in a heap at its end).
  assert.equal(new Set(live(moving).map((s) => moving.slots.tBirth[s])).size, moving.count);
  // A unit gone: its emitter stops, its particles live on.
  let gone = false;
  const h2: ParticleHost = { locate: (_u, _s, o) => { frameFromYaw(0, 0, 0, 0, o); return !gone; } };
  const p2 = createParticlePool({ capacity: 1000, seed: 1, host: h2, recipes: { carried } });
  const h = p2.emit("carried", 0, 0, 0, { unit: 1 });
  steps(p2, 10);
  gone = true;
  const n = p2.count;
  steps(p2, 10);
  assert.equal(p2.alive(h), false);
  assert.equal(p2.count, n);
});

test("the preset library: every preset valid, palette-driven (its ramps exist), sized in metres, and runs clean", () => {
  const { ramps, colours } = particlePalette();
  assert.ok(colours.length > 40 && colours.every((c) => c.every((v) => v >= 0 && v <= 255)));
  assert.deepEqual(Object.keys(ramps), Object.keys(PARTICLE_RAMPS));
  const names = Object.keys(PRESETS);
  for (const n of ["dust-puff", "footstep-dust", "spark-shower", "muzzle-flash", "explosion", "smoke-column", "fire", "magic-swirl", "blood-splat", "ichor-splat", "rain", "snow", "embers", "water-splash"]) assert.ok(names.includes(n), n);
  const pool = createParticlePool({ capacity: 50000, emitters: 512, seed: 1, recipes: PRESETS });
  for (const n of names) assert.deepEqual(recipeProblems(PRESETS[n]!), [], n);
  for (let s = 0; s < pool.styles.count; s += 1) assert.ok(Object.hasOwn(ramps, pool.styles.ramps[s]!), `${pool.recipeNames[s]} wears "${pool.styles.ramps[s]}"`);
  pool.setViewRect(-40, -40, 40, 40, 16);
  pool.wind.set([2, 0, 1]);
  for (const [i, n] of names.entries()) pool.emit(n, (i % 5) * 6 - 12, 0, Math.floor(i / 5) * 6 - 6, { duration: 2 });
  steps(pool, 720);
  assert.ok(pool.stats.spawned > 1000);
  const o = [0, 0, 0, 0, 0, 0];
  for (const s of live(pool)) { pool.sample(s, o); assert.ok(o.every(Number.isFinite), `${pool.recipeNames[pool.slots.style[s]!]}: ${o}`); }
  // Every size a real size; the style table's curves within range.
  const d = pool.styles.data;
  for (let s = 0; s < pool.styles.count; s += 1) {
    const r = (s * STYLE_WIDTH + CURVE_SAMPLES) * 4;
    assert.ok(d[r]! > 0 && d[r]! <= d[r + 1]! && d[r + 1]! < 3, `${pool.recipeNames[s]}: ${d[r]}..${d[r + 1]} m`);
    for (let k = 0; k < CURVE_SAMPLES; k += 1) { const a = d[(s * STYLE_WIDTH + k) * 4 + 2]!; assert.ok(a >= 0 && a <= 1); }
  }
  assert.ok(pool.list().length > 0 && pool.list().every((q) => q.size > 0 && q.light >= 0 && q.light <= 1 && q.p.every(Number.isFinite)), "list() for the pixel renderer");
  const atlas = particleSpriteAtlas();
  assert.equal(atlas.width, 48);
  assert.ok(atlas.data.slice(0, 8).every((v) => v === 0), "cell 0 (dot) is empty");
});

test("recipes are checked, curves sample linearly", () => {
  assert.equal(sampleCurve([0, 1], 0.25), 0.25);
  assert.equal(sampleCurve([1, 0.5, 0], 0.75), 0.25);
  assert.equal(sampleCurve(undefined, 0.3), 1);
  assert.throws(() => defineParticleRecipe({ mode: "burst", shape: "point", speed: [0, 1], particle: puff.particle }), /a burst needs a count/);
  assert.throws(() => defineParticleRecipe({ ...puff, particle: { ...puff.particle, sub: [{ on: "ground", emit: "x" }] } }), /ignores the ground/);
  assert.throws(() => createParticlePool({ recipes: { a: { ...puff, also: ["missing"] } } }), /isn't defined/);
  assert.throws(() => createParticlePool({ recipes: { puff } }).emit("nope", 0, 0, 0), /No particle recipe/);
});

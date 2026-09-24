import { test } from "node:test";
import assert from "node:assert/strict";
import { FLAG, WATER_NONE } from "@keel-engine/terrain";
import { DEFAULT_ACTS, createBiomeTable, createOverworld, fbm, hashLayers, noiseField, seedOf, simplex2 } from "../src/index.ts";
import type { TileLayers } from "../src/index.ts";

const same = (a: TileLayers, b: TileLayers, { i0, j0, w, d }: { i0: number; j0: number; w: number; d: number }): number => {
  let diff = 0;
  for (let j = j0; j < j0 + d; j += 1) for (let i = i0; i < i0 + w; i += 1) {
    const ka = (j - a.j0) * a.w + (i - a.i0), kb = (j - b.j0) * b.w + (i - b.i0);
    for (const L of ["height", "type", "water", "flags", "dir", "biome", "under", "ore", "zone"] as const) if (a[L][ka] !== b[L][kb]) { diff += 1; break; }
  }
  return diff;
};

test("noise: seeded, deterministic, in range, and different seeds differ", () => {
  const s = seedOf("w", "a");
  assert.equal(s, seedOf("w", "a"));
  assert.notEqual(s, seedOf("w", "b"));
  let lo = Infinity, hi = -Infinity;
  for (let n = 0; n < 5000; n += 1) { const v = simplex2(n * 0.37, n * 0.11, s); lo = Math.min(lo, v); hi = Math.max(hi, v); }
  assert.ok(lo >= -1 && hi <= 1 && hi - lo > 1.2, `simplex spans ${lo}..${hi}`);
  const f = noiseField(s, { freq: 1 / 50, octaves: 3, warp: { freq: 1 / 30, amp: 10 } });
  assert.equal(f(123.5, -77.25), f(123.5, -77.25));
  for (let n = 0; n < 2000; n += 1) { const v = fbm({ freq: 0.05, octaves: 4, ridged: n % 2 === 0 }, n, -n * 0.5, s); assert.ok(v >= 0 && v <= 1); }
});

test("overworld: the same seed builds the same tiles; another seed doesn't", () => {
  const a = createOverworld("det-1").block(-40, 10, 72, 60);
  const b = createOverworld("det-1").block(-40, 10, 72, 60);
  assert.equal(hashLayers(a, -40, 10, 32, 70), hashLayers(b, -40, 10, 32, 70));
  const c = createOverworld("det-2").block(-40, 10, 72, 60);
  assert.notEqual(hashLayers(a, -40, 10, 32, 70), hashLayers(c, -40, 10, 32, 70));
});

test("chunk independence: two chunks generated either way round, and inside one big block, agree tile for tile", () => {
  for (const seed of ["ci-1", "ci-2", "ci-3"]) {
    const C = 32, A = 2;
    // Order 1: chunk (3, -2) then (4, -2); order 2: the other way, on a fresh world (no shared caches).
    const w1 = createOverworld(seed), w2 = createOverworld(seed);
    const a1 = w1.block(3 * C - A, -2 * C - A, C + 2 * A, C + 2 * A), b1 = w1.block(4 * C - A, -2 * C - A, C + 2 * A, C + 2 * A);
    const b2 = w2.block(4 * C - A, -2 * C - A, C + 2 * A, C + 2 * A), a2 = w2.block(3 * C - A, -2 * C - A, C + 2 * A, C + 2 * A);
    assert.equal(same(a1, a2, { i0: 3 * C - A, j0: -2 * C - A, w: C + 2 * A, d: C + 2 * A }), 0, `${seed}: chunk A differs by order`);
    assert.equal(same(b1, b2, { i0: 4 * C - A, j0: -2 * C - A, w: C + 2 * A, d: C + 2 * A }), 0, `${seed}: chunk B differs by order`);
    // The overlap of the two aprons, and both chunks against one big block.
    assert.equal(same(a1, b1, { i0: 4 * C - A, j0: -2 * C - A, w: 2 * A, d: C }), 0, `${seed}: the aprons disagree`);
    const big = createOverworld(seed).block(3 * C - A, -2 * C - A, 2 * C + 2 * A, C + 2 * A);
    assert.equal(same(a1, big, { i0: 3 * C - A, j0: -2 * C - A, w: C + 2 * A, d: C + 2 * A }), 0, `${seed}: chunk A differs from the big block`);
    assert.equal(same(b1, big, { i0: 4 * C - A, j0: -2 * C - A, w: C + 2 * A, d: C + 2 * A }), 0, `${seed}: chunk B differs from the big block`);
  }
});

test("biome coverage: a big area has sea and land, most land biomes, none swallowing the world; acts restrict it", () => {
  const ow = createOverworld("coverage");
  const table = ow.table;
  const counts = new Map<string, number>();
  let tiles = 0, wet = 0, ramps = 0, rivers = 0;
  // (A coarse sample over 6,000 x 6,000 tiles: every 12th tile's column.)
  for (let j = -3000; j < 3000; j += 12) for (let i = -3000; i < 3000; i += 12) {
    const c = ow.column(i, j);
    const id = table.list[c.biome]!.id;
    counts.set(id, (counts.get(id) ?? 0) + 1);
    tiles += 1;
    if (c.water !== WATER_NONE && c.water > c.height) wet += 1;
    if (c.river >= 2) rivers += 1;
  }
  const B = ow.block(0, 0, 128, 128);
  for (let k = 0; k < B.w * B.d; k += 1) if (B.flags[k]! & FLAG.RAMP) ramps += 1;
  const share = (id: string): number => (counts.get(id) ?? 0) / tiles;
  const land = table.list.filter((b) => (b.kind ?? "land") === "land" && b.id !== "corruption");
  const seen = land.filter((b) => share(b.id) > 0.0005).map((b) => b.id);
  const stats = [...counts].sort((a, b) => b[1] - a[1]).map(([k, v]) => `${k} ${(100 * v / tiles).toFixed(1)}%`).join(", ");
  console.log(`# biome coverage over 6000 x 6000 tiles: ${stats}; water ${(100 * wet / tiles).toFixed(1)}%, river ${(100 * rivers / tiles).toFixed(1)}%`);
  assert.ok(wet / tiles > 0.15 && wet / tiles < 0.7, `water ${wet / tiles}`);
  assert.ok(seen.length >= land.length - 4, `land biomes seen: ${seen.join(", ")} of ${land.length}`);
  for (const [id, n] of counts) assert.ok(n / tiles < 0.45, `${id} covers ${(100 * n / tiles).toFixed(0)}%`);
  assert.equal(share("corruption"), 0, "corruption is never natural");
  assert.ok(rivers > 0, "rivers");
  assert.ok(ramps > 0, "ramps up the terraces");
  // An act: only its biomes appear.
  const act = DEFAULT_ACTS.find((a) => a.id === "act2")!;
  const ow2 = createOverworld("coverage", { params: { biomes: act.biomes } });
  const allowed = new Set(act.biomes);
  for (let j = -1500; j < 1500; j += 30) for (let i = -1500; i < 1500; i += 30) {
    const id = table.list[ow2.column(i, j).biome]!.id;
    assert.ok(allowed.has(id) || id === "ocean", `act 2 has ${id}`);
  }
});

test("biome table: data-driven, nearest in climate space, extensible", () => {
  const t = createBiomeTable();
  const hot = t.nearest({ temperature: 0.95, humidity: -0.9, continentalness: 0.3, erosion: 0, weirdness: 0 }, 2);
  assert.equal(t.list[hot.first]!.id, "desert");
  const cold = t.nearest({ temperature: -0.85, humidity: -0.3, continentalness: 0.3, erosion: 0, weirdness: 0 }, 2);
  assert.equal(t.list[cold.first]!.id, "tundra");
  const peaks = t.nearest({ temperature: -0.7, humidity: 0.2, continentalness: 0.3, erosion: -1, weirdness: 0 }, 9);
  assert.equal(t.list[peaks.first]!.id, "snowy-peaks");
  // A pack's biome joins by adding a point.
  const t2 = createBiomeTable([...t.list, { id: "mire", climate: { temperature: 0.1, humidity: 1.2 }, ground: [{ type: "mud", weight: 1 }], foliage: [] }]);
  assert.equal(t2.list[t2.nearest({ temperature: 0.1, humidity: 1.2, continentalness: 0.2, erosion: 0.8, weirdness: 0 }, 1).first]!.id, "mire");
  assert.throws(() => createBiomeTable([...t.list, t.list[0]!]), /Two biomes/);
});

test("structures: spacing and separation hold, the same whichever rectangle asks", () => {
  const ow = createOverworld("towns");
  const all = ow.structuresIn(-1500, -1500, 1500, 1500);
  assert.ok(all.length > 10, `${all.length} structures`);
  for (const def of ow.structureDefs) {
    const mine = all.filter((s) => s.def.id === def.id);
    for (let a = 0; a < mine.length; a += 1) for (let b = a + 1; b < mine.length; b += 1) {
      const d = Math.max(Math.abs(mine[a]!.ci - mine[b]!.ci), Math.abs(mine[a]!.cj - mine[b]!.cj));
      assert.ok(d >= def.separation, `${def.id}: ${mine[a]!.id} and ${mine[b]!.id} are ${d} apart`);
    }
  }
  const one = all.find((s) => s.def.id === "village") ?? all[0]!;
  const again = ow.structuresIn(one.ci - 2, one.cj - 2, one.ci + 2, one.cj + 2).find((s) => s.id === one.id);
  assert.ok(again, "found from a small rectangle");
  assert.equal(again.level, one.level);
  // Its ground is flat under it (the disc), stamped, and its things carry their structure.
  const B = ow.block(one.ci - 3, one.cj - 3, 6, 6);
  const h = B.height[3 * 6 + 3]!;
  for (let k = 0; k < 36; k += 1) if (B.zone[k]! >= 200 && !(B.flags[k]! & FLAG.BLOCKED)) assert.ok(Math.abs(B.height[k]! - h) <= 1 || B.type[k] === ow.types.id("brick"));
  assert.ok(one.things.every((th) => th.data?.["structure"] === one.id));
});

test("measured: overworld chunk generation", () => {
  const ow = createOverworld("bench");
  ow.block(0, 0, 36, 36); // (warm)
  const t0 = performance.now();
  let n = 0;
  for (let cz = 0; cz < 4; cz += 1) for (let cx = 0; cx < 4; cx += 1) { ow.block(cx * 32 - 2, cz * 32 - 2, 36, 36); n += 1; }
  const ms = (performance.now() - t0) / n;
  console.log(`# overworld chunk (32 x 32 + a 2-tile apron): ${ms.toFixed(1)} ms`);
  if (process.env["KEEL_PERF"] === "1") assert.ok(ms < 250);
});

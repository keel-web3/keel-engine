// The streaming bake: the order it bakes in (visible first, mains, then the
// signals, background behind foreground, weights, recency), re-ordering as the
// camera moves, the frame budget, cancellation, the debounced scale, stand-ins,
// eviction by tier and recency (never what's visible), the live atlas, and a
// bake that draws the same whatever order it baked in.

import { test } from "node:test";
import assert from "node:assert/strict";
import { RANK, createFrameBudget, createShelfAtlas, createSpriteStream, inferTier, planBake, renderIndexedSprites } from "../src/index.ts";
import type { BakedSprite, DesignSpec, IndexedSource, ShelfRect, SpriteStream, StreamDesign, StreamJob } from "../src/index.ts";
import { softIndexed } from "./soft-indexed.ts";

const spec = (key: string, clips: Array<[string, number]>, extra: Partial<DesignSpec> = {}): DesignSpec => ({ key, clips: clips.map(([name, frames]) => ({ name, frames })), height: 1, radius: 0.3, ...extra });
// A sprite whose texels come from its key (what a bake would make, without a GPU).
function fake(key: string, w = 6, h = 8): BakedSprite {
  let a = 2166136261;
  for (let i = 0; i < key.length; i += 1) a = Math.imul(a ^ key.charCodeAt(i), 16777619) >>> 0;
  const rgba = new Uint8Array(w * h * 4);
  for (let i = 0; i < rgba.length; i += 1) { a = Math.imul(a ^ i, 16777619) >>> 0; rgba[i] = a & 255; }
  return { key, w, h, ax: w >> 1, ay: h - 1, rgba };
}
const where = (st: SpriteStream, j: StreamJob) => `${j.design}|${j.clip}|${j.frame}|${j.direction}@${j.pixelsPerMetre}`;

// The scene: a hero (main), grunts (foreground, three clips), a crate and a cart (foreground, light and heavy), a
// rock (background: it stands still, inferred), a hat (a worn thing, foreground).
function scene(ladder = [8, 16, 32], extra: Partial<Parameters<typeof createSpriteStream>[0]> = {}) {
  const designs: StreamDesign[] = [
    { spec: spec("hero", [["idle", 2], ["walk", 3]]), tier: "main" },
    { spec: spec("grunt", [["idle", 2], ["walk", 3], ["run", 3]]), hints: { kind: "entity" } },
    { spec: spec("crate", [["still", 2]]), weight: 0 },
    { spec: spec("cart", [["still", 2]]), weight: 1 },
    { spec: spec("rock", [["still", 1]], { symmetric: true }) },
    { spec: spec("hat", [["still", 1]]), hints: { kind: "attribute" } },
  ];
  const st = createSpriteStream({ designs, ladder, directions: 4, dwell: 90, ...extra });
  const D = Object.fromEntries(designs.map((d, i) => [d.spec.key, i])) as Record<string, number>;
  return { st, D };
}

test("the order: what's visible (by tier), mains, then the signals -- background behind, weights and recency within", () => {
  const { st, D } = scene();
  st.setScale(16, 0);
  // An earlier frame saw the crate's first frame (a while back, not now).
  st.begin(0);
  st.seen[st.slotOf(D.crate!, 0, 0, 0)] = st.stamp;
  for (let i = 0; i < 5; i += 1) st.begin(i + 1);
  // Now: a grunt walking (frame 1, direction 2), wearing a hat; a rock; a grunt just outside the view, idling.
  st.seen[st.slotOf(D.grunt!, 1, 1, 2)] = st.stamp;
  st.seen[st.slotOf(D.hat!, 0, 0, 2)] = st.stamp;
  st.seen[st.slotOf(D.rock!, 0, 0, 0)] = st.stamp;
  st.near[st.slotOf(D.grunt!, 0, 0, 1)] = st.stamp;
  st.update(10);
  const jobs = st.take(100000);
  assert.ok(jobs.every((j, i) => i === 0 || j.rank >= jobs[i - 1]!.rank), "ranks never go back");
  const order = jobs.map((j) => where(st, j));
  const at = (s: string) => { const i = order.indexOf(s); assert.ok(i >= 0, `${s} is queued`); return i; };
  // Visible first: the foreground's (the grunt's frame, the hat), then the background's (the rock).
  assert.deepEqual(new Set(order.slice(0, 2)), new Set(["grunt|walk|1|2@16", "hat|still|0|2@16"]));
  assert.equal(order[2], "rock|still|0|0@16");
  // Then every sprite of the hero (main) at this scale, then at the neighbours.
  const heroHere = jobs.filter((j) => j.design === "hero" && j.pixelsPerMetre === 16);
  assert.equal(heroHere.length, 5 * 4);
  assert.ok(heroHere.every((j) => j.rank === RANK.preload));
  assert.ok(jobs.filter((j) => j.design === "hero" && j.pixelsPerMetre !== 16).every((j) => j.rank === RANK.mainNeighbour));
  // (a) the walking grunt's other frames, (b) its other directions, (c) the idler just outside, (d) the clips next to walk.
  assert.ok(at("grunt|walk|0|2@16") < at("grunt|walk|0|0@16"));
  assert.ok(at("grunt|walk|0|0@16") < at("grunt|idle|1|1@16"), "other directions before the unit outside the view");
  assert.ok(at("grunt|idle|1|1@16") < at("grunt|run|0|0@16"), "the unit outside before the likely clips");
  assert.ok(at("grunt|run|0|0@16") < at("grunt|walk|1|2@32"), "the likely clips before the neighbouring scales");
  // (e) what's visible, at the neighbouring scales, before (f) the rest at this one.
  assert.ok(at("grunt|walk|1|2@32") < at("cart|still|0|0@16"));
  assert.ok(at("hat|still|0|2@8") < at("cart|still|0|0@16"));
  // (f): by weight (the cart, then the grunt's, then the crate), and a crate frame seen before ahead of one never seen.
  assert.ok(at("cart|still|1|3@16") < at("crate|still|0|0@16"));
  assert.ok(at("crate|still|0|0@16") < at("crate|still|1|0@16"), "seen before goes first");
  // (g): the rest of the neighbouring scales last.
  assert.ok(at("cart|still|0|0@16") < at("cart|still|0|0@8"));
  // Background behind foreground: the rock at a neighbour scale after the foreground's visible there.
  assert.ok(at("hat|still|0|2@32") < at("rock|still|0|0@32"));
  // Nothing from a scale two steps away; nothing twice.
  assert.equal(new Set(order).size, order.length);
  assert.equal(st.take(10).length, 0, "all in flight");
});

test("re-ordered every frame: a camera move puts what it now sees first", () => {
  const { st, D } = scene();
  st.setScale(16, 0);
  st.begin(0);
  st.seen[st.slotOf(D.grunt!, 1, 1, 2)] = st.stamp;
  st.update(0);
  assert.equal(where(st, st.take(1)[0]!), "grunt|walk|1|2@16");
  // The camera moved: now the cart is on screen and the grunt isn't.
  st.begin(16);
  st.seen[st.slotOf(D.cart!, 0, 1, 3)] = st.stamp;
  st.update(16);
  const next = st.take(3).map((j) => where(st, j));
  assert.equal(next[0], "cart|still|1|3@16");
  assert.ok(!next.includes("grunt|walk|0|2@16"), "the grunt's frames no longer lead");
});

test("the frame budget: the spare time of a frame, between floor and ceiling; nothing hidden; all it can while loading", () => {
  const b = createFrameBudget({ frame: 8.33, margin: 1.2, floor: 0.75, ceiling: 6 });
  b.work(2);
  assert.ok(Math.abs(b.slice() - (8.33 - 1.2 - 2)) < 1e-9);
  b.work(1);
  assert.ok(b.slice() < 5.2 && b.slice() > 5, "a lighter frame is believed slowly");
  b.work(7.5);
  assert.ok(b.slice() <= 1.2, "a heavy frame is believed at once");
  b.work(9);
  assert.equal(b.slice(), 0.75, "never below the floor");
  const light = createFrameBudget();
  light.work(0.1);
  assert.equal(light.slice(), 6, "never above the ceiling");
  assert.equal(light.slice({ hidden: true }), 0);
  assert.equal(light.slice({ loading: true }), 40);
  light.slice(); light.spent(3);
  assert.ok(light.used > 0 && light.used <= 1);
});

test("cancelling: a job goes back in the order; a job for a scale left behind isn't wanted; another stream's is refused", () => {
  const { st, D } = scene([8, 12, 16, 24, 32]);
  st.setScale(16, 0);
  st.begin(0);
  st.seen[st.slotOf(D.grunt!, 1, 1, 2)] = st.stamp;
  st.update(0);
  const [job] = st.take(1);
  assert.ok(job && st.wanted(job));
  st.cancel(job);
  st.update(1);
  assert.equal(where(st, st.take(1)[0]!), where(st, job), "back at the front");
  // The view goes two steps in and settles: the 16 px/m job is no longer wanted (the hero's would be: a main).
  st.setScale(32, 10);
  st.begin(200); st.update(200);
  assert.equal(st.target, 32);
  assert.equal(st.wanted(job), false);
  // A job from another stream (the game replaced it) is never put into this one.
  const other = scene().st;
  other.setScale(16, 0); other.begin(0); other.update(0);
  const foreign = other.take(1)[0]!;
  assert.equal(st.put(foreign, fake(foreign.key)), false);
});

test("the scale is debounced: wheeling through levels bakes only the one it settles on", () => {
  const { st, D } = scene([8, 12, 16, 24, 32, 48]);
  st.setScale(16, 0);
  st.begin(0);
  st.seen[st.slotOf(D.grunt!, 1, 1, 2)] = st.stamp;
  st.update(0);
  st.take(100000); // (everything around 16 in flight)
  // Wheel: 24, 32, 48 in quick succession.
  st.setScale(24, 100); st.setScale(32, 130); st.setScale(48, 160);
  st.begin(170); st.seen[st.slotOf(D.grunt!, 1, 1, 2)] = st.stamp; st.update(170);
  assert.equal(st.target, 16, "still baking for where it was");
  assert.ok(st.take(100000).every((j) => j.pixelsPerMetre !== 32 && j.pixelsPerMetre !== 48), "nothing at a level passed through");
  st.begin(260); st.seen[st.slotOf(D.grunt!, 1, 1, 2)] = st.stamp; st.update(260);
  assert.equal(st.target, 48, "settled: 90 ms after the last step");
  const first = st.take(1)[0]!;
  assert.equal(where(st, first), "grunt|walk|1|2@48", "and the view's sprites there first");
  assert.ok(st.take(100000).every((j) => j.pixelsPerMetre !== 24), "the level it passed through is never baked");
});

test("stand-ins: a larger scale drawn smaller first, a smaller one only a little blown up, the nearest frame at this scale before either", () => {
  const bake = (st: SpriteStream, want: (j: StreamJob) => boolean) => { st.begin(0); st.update(0); for (const j of st.take(100000)) { if (want(j)) st.put(j, fake(j.key)); else st.cancel(j); } };
  const { st, D } = scene([8, 16, 32]);
  st.setScale(16, 0);
  const s = st.slotOf(D.grunt!, 1, 1, 2);
  const o = s * 9;
  // Only the 32 and 8 px/m bakes of that sprite: the larger one stands in.
  bake(st, (j) => j.design === "grunt" && j.clip === "walk" && j.frame === 1 && j.direction === 2 && j.pixelsPerMetre !== 16);
  st.begin(1);
  assert.equal(st.lut[o + 7], 32, "larger preferred");
  assert.equal(st.exact[s], 0);
  // Its own clip's frame 0 at 16: the nearest frame at the view's scale beats the exact frame at another.
  bake(st, (j) => j.design === "grunt" && j.clip === "walk" && j.frame === 0 && j.direction === 2 && j.pixelsPerMetre === 16);
  st.begin(2);
  assert.equal(st.lut[o + 7], 16);
  assert.equal(st.lut[o + 8], 0, "showing frame 0");
  // Only a smaller bake: 2x is allowed (the default), 4x isn't -- nothing is drawn rather than a blown-up box.
  const b = scene([8, 16, 32]);
  b.st.setScale(16, 0);
  bake(b.st, (j) => j.pixelsPerMetre === 8);
  b.st.begin(1);
  assert.equal(b.st.lut[s * 9 + 7], 8);
  b.st.setScale(32, 2); b.st.begin(3);
  assert.equal(b.st.lut[s * 9 + 7], 0, "32 from 8 would be 4x: nothing");
  assert.equal(b.st.lut[s * 9 + 2], 0);
});

test("eviction: background first, mains last, the least recently drawn first -- never what the last frames drew", () => {
  // One 64 px page: four 30 x 30 sprites. One direction, 16 px/m and 8.
  const designs: StreamDesign[] = [
    { spec: spec("rock", [["still", 1]], { symmetric: true }) },
    { spec: spec("grunt", [["walk", 2]]), hints: { kind: "entity" } },
    { spec: spec("hero", [["walk", 2]]), tier: "main" },
    { spec: spec("cart", [["still", 1]]) },
  ];
  const st = createSpriteStream({ designs, ladder: [8, 16], directions: 1, memory: 64 * 64 * 4, pageSize: 64 });
  st.setScale(16, 0);
  st.begin(0); st.update(0);
  const jobs = new Map(st.take(1000).filter((j) => j.pixelsPerMetre === 16).map((j) => [`${j.design}${j.frame}`, j]));
  for (const j of st.take(1000)) st.cancel(j);
  const put = (name: string) => st.put(jobs.get(name)!, fake(jobs.get(name)!.key, 30, 30));
  for (const n of ["rock0", "grunt0", "grunt1", "hero0"]) assert.ok(put(n), `${n} fits`);
  assert.equal(st.stats().pages, 1);
  // The grunt is on screen.
  st.begin(1); st.seen[st.slotOf(1, 0, 0, 0)] = st.stamp; st.update(1);
  assert.ok(put("hero1"), "the hero's second frame fits: the rock went (background, not drawn)");
  assert.equal(st.has(st.slotOf(0, 0, 0, 0), 16), false);
  assert.equal(st.has(st.slotOf(1, 0, 0, 0), 16), true, "the grunt is on screen: kept");
  // Now the cart comes on screen, the grunt left three frames ago: the grunt (foreground) goes before the hero (main).
  for (let i = 2; i < 5; i += 1) st.begin(i);
  st.seen[st.slotOf(3, 0, 0, 0)] = st.stamp; st.update(5);
  assert.ok(put("cart0"));
  assert.equal(st.has(st.slotOf(1, 0, 0, 0), 16), false, "the grunt went");
  assert.equal(st.has(st.slotOf(2, 0, 0, 0), 16) && st.has(st.slotOf(2, 0, 1, 0), 16), true, "the hero stays");
  assert.ok(st.stats().evictions >= 2);
});

test("the live atlas: no overlaps, freed room reused, full when full", () => {
  const atlas = createShelfAtlas({ size: 128, pages: 2 });
  let a = 7;
  const r = () => { a = (Math.imul(a, 1103515245) + 12345) >>> 0; return a / 4294967296; };
  const live: ShelfRect[] = [];
  for (let step = 0; step < 3000; step += 1) {
    if (live.length && r() < 0.45) { atlas.free(live.splice(Math.floor(r() * live.length), 1)[0]!); continue; }
    const got = atlas.alloc(2 + Math.floor(r() * 30), 2 + Math.floor(r() * 30));
    if (got) live.push(got);
  }
  for (let i = 0; i < live.length; i += 1) for (let j = i + 1; j < live.length; j += 1) {
    const p = live[i]!, q = live[j]!;
    if (p.page !== q.page) continue;
    assert.ok(p.x + p.w <= q.x || q.x + q.w <= p.x || p.y + p.h <= q.y || q.y + q.h <= p.y, "no two sprites overlap");
  }
  assert.ok(live.every((p) => p.x + p.w <= 128 && p.y + p.h <= 128 && p.page < 2));
  assert.equal(atlas.used, live.reduce((n, p) => n + p.w * p.h * 4, 0));
  for (const p of live.splice(0)) atlas.free(p);
  assert.equal(atlas.used, 0);
  const full = createShelfAtlas({ size: 32, pages: 1 });
  assert.ok(full.alloc(31, 31));
  assert.equal(full.alloc(4, 4), null);
});

test("baked the same whatever the order: every sprite's texels in the atlas, by key, in any bake order and batching", () => {
  const sources = new Map<string, IndexedSource>([
    ["a", { pose: (_c, f) => ({ capsules: [{ a: [0, 0.02, 0], b: [0, 0.02, 0], r: 0.05, mat: 2 }, { a: [0.1 * f, 1, 0], b: [0, 1, 0], r: 0.09, mat: 5 }] }) }],
    ["b", { pose: () => ({ capsules: [{ a: [0, 0.5, 0], b: [0, 0.5, 0], r: 0.2, mat: 7 }] }) }],
  ]);
  const designs: StreamDesign[] = [{ spec: spec("a", [["walk", 3]], { height: 1.2, radius: 0.4 }) }, { spec: spec("b", [["still", 1]], { height: 0.8, radius: 0.3 }) }];
  const run = (order: (jobs: StreamJob[]) => StreamJob[][]) => {
    const pages: Uint8Array[] = [];
    const st = createSpriteStream({
      designs, ladder: [20], directions: 4, pageSize: 256,
      onPages: (n) => { while (pages.length < n) pages.push(new Uint8Array(256 * 256 * 4)); },
      onWrite: (r, rgba) => { for (let y = 0; y < r.h; y += 1) pages[r.page]!.set(rgba.subarray(y * r.w * 4, (y + 1) * r.w * 4), ((r.y + y) * 256 + r.x) * 4); },
    });
    st.setScale(20, 0); st.begin(0); st.update(0);
    const R = softIndexed();
    for (const batch of order(st.take(1000))) for (const s of renderIndexedSprites(R, batch, sources, { staging: 64, distance: 80, compensate: false }).baked) st.put(batch.find((j) => j.key === s.key)!, s);
    st.begin(1);
    // Each key's texels, read back out of the pages through the lookup.
    const out = new Map<string, number[]>();
    for (let s = 0; s < st.slots; s += 1) {
      const o = s * 9, w = st.lut[o + 2]!, h = st.lut[o + 3]!, x = st.lut[o]!, y = st.lut[o + 1]!, p = st.lut[o + 6]!;
      const px: number[] = [w, h, st.lut[o + 4]!, st.lut[o + 5]!];
      for (let r = 0; r < h; r += 1) px.push(...pages[p]!.subarray(((y + r) * 256 + x) * 4, ((y + r) * 256 + x + w) * 4));
      out.set(String(s), px);
    }
    return out;
  };
  const inOrder = run((jobs) => [jobs]);
  const reversed = run((jobs) => jobs.slice().reverse().map((j) => [j]));
  const threes = run((jobs) => { const shuffled = jobs.slice().sort((x, y) => (x.key.length * 31 + x.frame * 7 + x.direction) % 5 - (y.key.length * 31 + y.frame * 7 + y.direction) % 5); const b: StreamJob[][] = []; for (let i = 0; i < shuffled.length; i += 3) b.push(shuffled.slice(i, i + 3)); return b; });
  assert.equal(inOrder.size, 3 * 4 + 4);
  assert.deepEqual(reversed, inOrder);
  assert.deepEqual(threes, inOrder);
});

test("tiers: said, set (a lock wins), or inferred -- a player's or one-of-a-kind unit is main, props and still things background", () => {
  const d = (key: string, extra: Partial<StreamDesign> = {}): StreamDesign => ({ spec: spec(key, [["walk", 4]]), ...extra });
  assert.deepEqual(inferTier(d("x", { tier: "background", weight: 0.9 })), { tier: "background", weight: 0.9, from: "design" });
  assert.equal(inferTier(d("p", { hints: { player: true } })).tier, "main");
  assert.equal(inferTier(d("boss", { hints: { count: 1, kind: "entity" } })).tier, "main");
  assert.equal(inferTier(d("grunt", { hints: { count: 400, kind: "entity" } })).tier, "foreground");
  assert.equal(inferTier(d("tuft", { hints: { kind: "prop" } })).tier, "background");
  assert.equal(inferTier({ spec: spec("stone", [["still", 1]], { symmetric: true }) }).tier, "background");
  assert.equal(inferTier(d("hat")).tier, "foreground");
  // Settings (world's Settings fits): by id and by tag; a lock beats even the design's own field.
  const settings = {
    get: (key: string, thing?: { id: string; tags?: readonly string[] | undefined } | null) => (key === "bake.tier" ? (thing?.id === "banner" ? "main" : thing?.tags?.includes("crowd") ? "background" : undefined) : key === "bake.weight" && thing?.id === "banner" ? 0.8 : undefined),
    locked: (key: string, thing?: { id: string } | null) => key === "bake.tier" && thing?.id === "banner",
  };
  assert.deepEqual(inferTier(d("banner", { tier: "foreground" }), settings), { tier: "main", weight: 0.8, from: "settings" });
  assert.equal(inferTier(d("extra", { hints: { tags: ["crowd"] } }), settings).tier, "background");
  assert.equal(inferTier(d("extra", { tier: "foreground", hints: { tags: ["crowd"] } }), settings).tier, "foreground", "unlocked: the design's own field wins");
});

test("the stream's jobs are the plan's: the same keys, boxes and angles", () => {
  const { st } = scene([16]);
  st.setScale(16, 0); st.begin(0); st.update(0);
  const jobs = st.take(100000);
  const plan = planBake(scene([16]).st ? [spec("grunt", [["idle", 2], ["walk", 3], ["run", 3]])] : [], { directions: 4, pixelsPerMetre: 16, pitch: 0.6 });
  const mine = new Map(jobs.filter((j) => j.design === "grunt").map((j) => [j.key, j]));
  assert.equal(mine.size, plan.sprites.length);
  for (const p of plan.sprites) { const j = mine.get(p.key)!; assert.ok(j, p.key); assert.equal(j.w, p.w); assert.equal(j.h, p.h); assert.equal(j.angle, p.angle); }
});

test("preload: the opening view exactly, its clips complete, mains complete, every design's first frames -- and progress", () => {
  const { st, D } = scene([8, 16, 32]);
  st.setScale(16, 0);
  st.begin(0);
  st.seen[st.slotOf(D.grunt!, 1, 1, 2)] = st.stamp;
  st.update(0);
  const n = st.preload();
  // hero 20 (main, complete) + grunt: walk dir 2 complete (3) + first frames of 3 clips x 4 dirs (12, one of them the
  // walk's dir-2 frame 0 again) + crate 4, cart 4, rock 1, hat 4.
  assert.equal(n, 20 + 3 + 12 - 1 + 4 + 4 + 1 + 4);
  assert.deepEqual(st.preloading, { done: 0, total: n });
  st.update(1);
  const jobs = st.take(100000, RANK.mainNeighbour);
  assert.ok(jobs.length >= n && jobs.every((j) => j.rank <= RANK.mainNeighbour));
  for (const j of jobs) st.put(j, fake(j.key));
  assert.deepEqual(st.preloading, { done: n, total: n });
});

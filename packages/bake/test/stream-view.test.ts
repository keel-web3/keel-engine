// The stream's additions for keel/view's deep zoom: the lookup re-resolves only
// the groups a bake or an eviction touched (the same lookup a full resolve
// makes, far cheaper on a big stream), a design's largest scale (baked no
// closer, its top bake standing in however far it's blown up), and actions
// baked with a population's bodies (ACTION_BAKE_CLIPS).

import { test } from "node:test";
import assert from "node:assert/strict";
import { ACTION_BAKE_CLIPS, STREAM_LUT, createSpriteStream, populateShapes } from "../src/index.ts";
import type { BakedSprite, DesignSpec, SpriteStream, StreamDesign, StreamJob } from "../src/index.ts";
import { armyCast } from "./cast.ts";

const spec = (key: string, clips: Array<[string, number]>, extra: Partial<DesignSpec> = {}): DesignSpec => ({ key, clips: clips.map(([name, frames]) => ({ name, frames })), height: 1, radius: 0.3, ...extra });
const fake = (key: string, w = 6, h = 8): BakedSprite => ({ key, w, h, ax: w >> 1, ay: h - 1, rgba: new Uint8Array(w * h * 4).fill(key.length & 255) });

function streamOf(extra: Partial<Parameters<typeof createSpriteStream>[0]> = {}, designs?: StreamDesign[]): SpriteStream {
  return createSpriteStream({
    designs: designs ?? [
      { spec: spec("walker", [["idle", 3], ["walk", 5]]) },
      { spec: spec("runner", [["walk", 4], ["run", 4]]), tier: "main" },
      { spec: spec("tree", [["still", 1]], { symmetric: true }), maxScale: 16 },
      { spec: spec("hat", [["still", 1]]) },
    ],
    ladder: [4, 8, 16, 32, 64], directions: 4, dwell: 0, memory: 64 * 1024 * 1024, pageSize: 512, ...extra,
  });
}
const lutOf = (st: SpriteStream) => Array.from(st.lut);
/** A full re-resolve: the view's scale away and back (every slot resolved again). */
function fullResolve(st: SpriteStream, now: number): number[] {
  const k = st.scale;
  st.setScale(st.ladder.find((x) => x !== k)!, now); st.begin(now);
  st.setScale(k, now); st.begin(now);
  return lutOf(st);
}

test("the lookup re-resolves only the groups a bake touched -- the same lookup as resolving everything", () => {
  const st = streamOf();
  st.setScale(16, 0);
  let t = 1;
  let rng = 11;
  const r = () => { rng = (Math.imul(rng, 1103515245) + 12345) >>> 0; return rng / 4294967296; };
  for (let round = 0; round < 40; round += 1) {
    st.begin(t);
    for (let s = 0; s < st.slots; s += 1) if (r() < 0.3) st.seen[s] = st.stamp;
    st.update(t);
    const jobs: StreamJob[] = st.take(1 + Math.floor(r() * 12));
    for (const j of jobs) if (r() < 0.8) st.put(j, fake(j.key, 4 + Math.floor(r() * 30), 4 + Math.floor(r() * 40))); else st.cancel(j);
    st.begin(t += 1); // (the incremental resolve)
    const inc = lutOf(st);
    assert.deepEqual(fullResolve(st, t += 1), inc, `round ${round}: incremental == full`);
    // Now and then the zoom moves (a full resolve is due), and back.
    if (round % 7 === 3) { st.setScale(r() < 0.5 ? 8 : 32, t); st.begin(t += 1); st.update(t); }
  }
});

test("an eviction re-resolves what it took away: the lookup still equals a full resolve", () => {
  // (A small atlas: puts past it evict.)
  const st = streamOf({ memory: 512 * 512 * 4, pageSize: 512 });
  st.setScale(8, 0);
  let t = 1;
  for (let round = 0; round < 30; round += 1) {
    st.begin(t);
    // (One design on screen a round, the others not: what's left behind can be evicted.)
    const d = round % 4;
    for (let s = st.base[d]!; s < (d + 1 < 4 ? st.base[d + 1]! : st.slots); s += 1) st.seen[s] = st.stamp;
    st.update(t);
    for (const j of st.take(50)) st.put(j, fake(j.key, 60, 90));
    st.begin(t += 1);
    const inc = lutOf(st);
    assert.deepEqual(fullResolve(st, t += 1), inc, `round ${round}`);
  }
  assert.ok(st.stats().evictions > 0, "it evicted");
});

test("a design's largest scale: never baked past it; its top bake stands in however far it's blown up", () => {
  const st = streamOf();
  const tree = 2;
  st.setScale(64, 0);
  st.begin(1);
  const slot = st.slotOf(tree, 0, 0, 0);
  st.seen[slot] = st.stamp;
  st.seen[st.slotOf(0, 0, 0, 0)] = st.stamp;
  st.update(1);
  const jobs = st.take(100000);
  const treeJobs = jobs.filter((j) => j.design === "tree");
  assert.ok(treeJobs.length >= 1, "the tree is baked...");
  assert.ok(treeJobs.every((j) => j.pixelsPerMetre === 16), `...at its largest scale only (${treeJobs.map((j) => j.pixelsPerMetre).join(",")})`);
  assert.ok(st.wanted(treeJobs[0]!), "and that job stays wanted while the view is past it");
  assert.ok(treeJobs[0]!.rank <= 2, "ranked as what's visible (a background thing's visible rank)");
  for (const j of jobs) st.put(j, fake(j.key));
  st.begin(2);
  const o = slot * STREAM_LUT;
  assert.equal(st.lut[o + 7], 16, "drawn from its 16 px/m bake at 64 px/m (4x: past the stream's upscale of 2)");
  assert.ok(st.lut[o + 2]! > 0);
  // And the walker (no cap) at 64 is its own bake.
  assert.equal(st.lut[st.slotOf(0, 0, 0, 0) * STREAM_LUT + 7], 64);
  // Past its scale it's not counted missing.
  st.seen[slot] = st.stamp;
  st.update(3);
  assert.equal(st.missingVisible, 0);
});

test("a population with clipsFor: people and animals each bake their gaits and keel/entity's attack", () => {
  const cast = armyCast();
  const shapes = populateShapes({ seed: "act", count: 40, entities: cast.entities.slice(0, 4).concat(cast.entities.filter((e) => e.def.id === "dog" && e.pack === "packs/animals")), attributes: cast.attributes, shapes: 1, clipsFor: ACTION_BAKE_CLIPS });
  for (const b of shapes.bodies) {
    const names = b.clips.map((c) => c.name);
    assert.deepEqual(names, ACTION_BAKE_CLIPS(b.spec.plan).map((c) => c.name));
    const info = b.clip("attack");
    assert.equal(info.cycle, 0, "an action is played by time, not distance");
    assert.ok(Math.abs(info.period - 0.62) < 1e-9);
    // The strike moves the body: frame 4 (the strike) differs from frame 0 (rest).
    const a = b.capsules("attack", 0), s = b.capsules("attack", 4);
    const moved = a.reduce((m, c, i) => Math.max(m, Math.hypot(c.b[0] - s[i]!.b[0], c.b[1] - s[i]!.b[1], c.b[2] - s[i]!.b[2])), 0);
    assert.ok(moved > 0.05, `${b.spec.species}: the attack moves it (${moved.toFixed(2)} m)`);
    // A skeleton for a live 3D view: at the origin.
    const sk = b.skeleton("walk", 2);
    assert.ok(sk && typeof sk === "object");
  }
  // (Without clipsFor, the defaults as ever.)
  const plain = populateShapes({ seed: "act", count: 5, entities: cast.entities.slice(0, 2), attributes: [], shapes: 1 });
  assert.ok(plain.bodies.every((b) => !b.clips.some((c) => c.name === "attack")));
});

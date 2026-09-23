// The stream pump: the take -> bake -> put loop, its budget gate, and what it does with jobs the view moved past.

import { test } from "node:test";
import assert from "node:assert/strict";
import { createFrameBudget, createSpriteStream, createStreamPump } from "../src/index.ts";
import type { DesignSpec, IndexedBakeRenderer, StreamDesign } from "../src/index.ts";

const spec = (key: string, frames: number): DesignSpec => ({ key, clips: [{ name: "still", frames }], height: 1, radius: 0.3 });
// No renderer is touched: with no source for a design, bakeSlice has nothing to draw.
const nothing = { indexed: (() => undefined) as never };
const renderer = null as unknown as IndexedBakeRenderer;

function scene() {
  const designs: StreamDesign[] = [{ spec: spec("tree", 1) }, { spec: spec("bush", 2) }];
  const st = createSpriteStream({ designs, ladder: [8, 16, 32], directions: 1 });
  return { st, D: { tree: 0, bush: 1 } };
}

test("pump: a slice takes what the stream wants and gives the budget back what it spent", () => {
  const { st, D } = scene();
  st.setScale(16, 0);
  st.begin(0);
  st.seen[st.slotOf(D.tree, 0, 0, 0)] = st.stamp;
  st.update(0);
  const budget = createFrameBudget();
  const pump = createStreamPump(st, { renderer, sources: nothing, budget });
  const landed = pump.slice();
  // Nothing can be baked without a source, so nothing lands -- but the jobs were taken and accounted for.
  assert.equal(landed, 0);
  assert.ok(pump.stats.jobs > 0, "it took jobs");
  assert.equal(pump.stats.landed + pump.stats.dropped, pump.stats.jobs, "every job taken is landed or dropped");
});

test("pump: no budget, no bake", () => {
  const { st, D } = scene();
  st.setScale(16, 0);
  st.begin(0);
  st.seen[st.slotOf(D.tree, 0, 0, 0)] = st.stamp;
  st.update(0);
  const pump = createStreamPump(st, { renderer, sources: nothing });
  assert.equal(pump.slice(0), 0);
  assert.equal(pump.stats.jobs, 0, "it took nothing");
});

test("pump: an empty stream is a no-op", () => {
  const st = createSpriteStream({ designs: [{ spec: spec("tree", 1) }], ladder: [8], directions: 1 });
  const pump = createStreamPump(st, { renderer, sources: nothing });
  st.setScale(8, 0);
  st.begin(0);
  st.update(0);
  pump.slice();
  // Nothing was marked as drawn, so nothing outranks the prefetch -- and whatever it took, it accounted for.
  assert.equal(pump.stats.landed + pump.stats.dropped, pump.stats.jobs);
});

test("pump: `most` caps a slice however generous the budget", () => {
  const { st, D } = scene();
  st.setScale(16, 0);
  st.begin(0);
  st.seen[st.slotOf(D.tree, 0, 0, 0)] = st.stamp;
  st.seen[st.slotOf(D.bush, 0, 0, 0)] = st.stamp;
  st.update(0);
  const pump = createStreamPump(st, { renderer, sources: nothing, most: 1 });
  pump.slice(40);
  assert.equal(pump.stats.jobs, 1);
});

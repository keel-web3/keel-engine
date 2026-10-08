import { test } from "node:test";
import assert from "node:assert/strict";
import { createTargetCache } from "../src/target-cache.ts";

function measured() {
  let next = 0, liveBytes = 0, peakBytes = 0;
  const events: string[] = [], live = new Set<number>();
  const cache = createTargetCache(2, (width, height) => {
    const target = { id: ++next, width, height, bytes: width * height * 32 };
    live.add(target.id); liveBytes += target.bytes; peakBytes = Math.max(peakBytes, liveBytes);
    events.push(`create:${target.id}`);
    return target;
  }, target => {
    assert.ok(live.delete(target.id), "a GPU workspace is released once");
    liveBytes -= target.bytes; events.push(`dispose:${target.id}`);
  });
  return { cache, live, events, bytes: () => liveBytes, peak: () => peakBytes };
}

test("mobile toolbar resizes retain one current portrait buffer and release before allocating", () => {
  const m = measured();
  for (const height of [844, 760, 820, 844, 760]) {
    const target = m.cache.get(390, height, 390, height);
    assert.equal(target.height, height, "the requested rendering resolution is preserved");
    assert.deepEqual(m.cache.stats(), { workspaces: 1, pixels: 390 * height });
    assert.equal(m.bytes(), 390 * height * 32);
  }
  assert.equal(m.peak(), 390 * 844 * 32, "old portrait sizes never overlap the new allocation");
  assert.deepEqual(m.events, ["create:1", "dispose:1", "create:2", "dispose:2", "create:3", "dispose:3", "create:4", "dispose:4", "create:5"]);
});

test("main, mirror and parking bake reuse exact workspaces across frames", () => {
  const m = measured(), get = (w: number, h: number) => m.cache.get(w, h, 390, 844);
  const main = get(390, 844), mirror = get(195, 422), atlas = get(64, 64);
  for (let frame = 0; frame < 120; frame++) {
    assert.equal(get(195, 422), mirror); assert.equal(get(390, 844), main); assert.equal(get(64, 64), atlas);
  }
  assert.deepEqual(m.events, ["create:1", "create:2", "create:3"]);
  assert.equal(m.bytes(), (390 * 844 + 195 * 422 + 64 * 64) * 32);
  assert.equal(m.cache.stats().workspaces, 3);
});

test("an export evicts auxiliary workspaces without evicting the canvas", () => {
  const m = measured(), get = (w: number, h: number) => m.cache.get(w, h, 390, 844);
  const main = get(390, 844), mirror = get(195, 422);
  get(64, 64); get(195, 422);
  const start = m.events.length;
  const exported = get(1200, 630);
  assert.equal(get(390, 844), main); assert.equal(get(195, 422), mirror);
  assert.deepEqual(m.events.slice(start), ["dispose:3", `create:${exported.id}`]);
  assert.equal(m.cache.stats().workspaces, 3);
});

test("orientation change promotes a matching auxiliary and never reuses a released primary", () => {
  const m = measured();
  const oldMain = m.cache.get(390, 844, 390, 844);
  const landscape = m.cache.get(844, 390, 390, 844);
  assert.equal(m.cache.get(844, 390, 844, 390), landscape, "a matching export needs no second buffer");
  assert.ok(!m.live.has(oldMain.id));
  const reusedSize = m.cache.get(390, 844, 844, 390);
  assert.notEqual(reusedSize, oldMain, "the old primary size as an offscreen draw gets a fresh workspace");
  assert.deepEqual(m.cache.stats(), { workspaces: 2, pixels: 2 * 390 * 844 });
});

import { test } from "node:test";
import assert from "node:assert/strict";
import { createSizeCache } from "../src/size-cache.ts";

test("main and mirror workspaces are reused; resizing evicts only the least recently used workspace", () => {
  let allocations = 0;
  const released: number[] = [];
  const get = createSizeCache(2, (width, height) => ({ width, height, id: ++allocations }), value => released.push(value.id));
  const main = get(1600, 900), mirror = get(800, 450);
  for (let frame = 0; frame < 240; frame++) {
    assert.equal(get(800, 450), mirror);
    assert.equal(get(1600, 900), main);
  }
  assert.equal(allocations, 2); assert.deepEqual(released, []);
  get(390, 844);
  assert.deepEqual(released, [mirror.id]);
  assert.equal(get(1600, 900), main);
  get(195, 422);
  assert.deepEqual(released, [mirror.id, 3]);
});

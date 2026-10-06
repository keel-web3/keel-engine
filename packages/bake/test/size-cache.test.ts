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


test("resizing never exceeds the live GPU workspace limit, even during allocation", () => {
  let live=0,peak=0;
  const get=createSizeCache(2, (w,h)=>{peak=Math.max(peak,++live);return {w,h};},()=>live--);
  for(let n=0;n<30;n++) get(390+n,844+n);
  assert.equal(peak,2);assert.equal(live,2);
});

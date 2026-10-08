import assert from "node:assert/strict";
import { test } from "node:test";
import { PERSONAL_TRANSPORT, personalTransportWorld } from "../src/index.ts";

test("canonical scooters and boards retain their full collidable footprint in every LOD", () => {
  for (const kind of ["scooter", "skateboard"] as const) for (const level of [0, 1, 2] as const) {
    const world = personalTransportWorld(kind, level);
    assert.deepEqual(world, personalTransportWorld(kind, level));
    assert.ok((world.boxes?.length ?? 0) + (world.capsules?.length ?? 0) <= 10);
    for (const b of world.boxes ?? []) {
      assert.ok(Math.hypot(Math.abs(b.c[0]!) + b.h[0]!, Math.abs(b.c[2]!) + b.h[2]!) <= PERSONAL_TRANSPORT[kind].radius);
      assert.ok(b.c[1]! - b.h[1]! >= 0);
    }
    for (const c of world.capsules ?? []) for (const p of [c.a, c.b]) {
      assert.ok(Math.hypot(p[0]!, p[2]!) + c.r <= PERSONAL_TRANSPORT[kind].radius);
      assert.ok(p[1]! - c.r >= -1e-9);
    }
    assert.ok(world.boxes!.some(b => Math.abs(b.c[1]! + b.h[1]! - PERSONAL_TRANSPORT[kind].deck) < .01));
    assert.equal(world.capsules!.some(c => c.a[1]! > 1), kind === 'scooter');
  }
});

// The scene's half of the proof of concept's tests/frame.test.mjs: entities
// (kit rotation) turn the way the core frame says things turn.

import { test } from "node:test";
import assert from "node:assert/strict";
import { frontOf, localToWorld } from "@keel-engine/core";
import { createEntity, dirToWorld, toWorld } from "../src/entity.ts";

const near = (a: readonly number[], b: readonly number[], e = 1e-9): boolean => a.every((v, i) => Math.abs(v - b[i]!) < e);
const YAWS = Array.from({ length: 24 }, (_, i) => -Math.PI + (i + 0.5) * (Math.PI / 12));

test("scene entities (kit rotation) turn the same way", () => {
  for (const y of YAWS) {
    const e = createEntity({ id: "e", transform: { pos: [1, 2, 3], yaw: y } });
    assert.ok(near(toWorld(e, [0.4, 0.5, 0.6]), localToWorld([1, 2, 3], y, [0.4, 0.5, 0.6]), 1e-12));
    assert.ok(near(dirToWorld(e, [0, 0, 1]), frontOf(y), 1e-12));
  }
});

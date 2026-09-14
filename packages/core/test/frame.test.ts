// The port of the proof of concept's tests/frame.test.mjs: the one frame
// convention, and the systems that must agree with it. (Scene entities are
// checked in @keel-engine/scene's own frame test; physics boxes against the
// proof of concept's physics until @keel-engine/physics is ported.)

import { test } from "node:test";
import assert from "node:assert/strict";
import { cameraBasis, frontOf, fromNocturnesYaw, localToWorld, moveFromView, rightOf, worldToLocal, yawOf, yawTo } from "../src/frame.ts";
import type { Vec3, Vec3Like } from "../src/math.ts";
import { POC, hasPoc, poc } from "./reference.ts";

const near = (a: readonly number[], b: readonly number[], e = 1e-9): boolean => a.every((v, i) => Math.abs(v - b[i]!) < e);
const dot = (a: Vec3Like, b: Vec3Like): number => a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
const YAWS = Array.from({ length: 24 }, (_, i) => -Math.PI + (i + 0.5) * (Math.PI / 12));

test("yaw 0 faces +z with its right hand at +x", () => {
  assert.ok(near(frontOf(0), [0, 0, 1]));
  assert.ok(near(rightOf(0), [1, 0, 0]));
  assert.ok(near(frontOf(Math.PI / 2), [1, 0, 0], 1e-12)); // (a quarter turn faces +x)
});

test("yawOf / yawTo / frontOf agree, and local <-> world round-trips", () => {
  for (const y of YAWS) {
    assert.ok(Math.abs(yawOf(frontOf(y)) - y) < 1e-12);
    const pos: Vec3 = [3, 1, -2];
    const p = localToWorld(pos, y, [0, 0, 5]);
    assert.ok(Math.abs(yawTo(pos, p) - y) < 1e-12);
    assert.ok(near(worldToLocal(pos, y, localToWorld(pos, y, [0.3, -1, 2])), [0.3, -1, 2], 1e-12));
    assert.ok(near(localToWorld([0, 0, 0], y, [1, 0, 0]), rightOf(y), 1e-12));
  }
});

test("a camera behind a thing sees its right hand on the screen's right; in front, on the left", () => {
  for (const y of YAWS) {
    const pos: Vec3 = [0, 0, 0];
    const hand = localToWorld(pos, y, [0.5, 1, 0]);
    const behind = localToWorld(pos, y, [0, 1, -4]);
    const ahead = localToWorld(pos, y, [0, 1, 4]);
    const b = cameraBasis(behind, [0, 1, 0]);
    const a = cameraBasis(ahead, [0, 1, 0]);
    assert.ok(dot(b.right, [hand[0], hand[1] - 1, hand[2]]) > 0, "seen from behind: right hand on screen right");
    assert.ok(dot(a.right, [hand[0], hand[1] - 1, hand[2]]) < 0, "seen from the front: right hand on screen left");
    assert.ok(b.up[1] > 0.99, "up is up");
  }
});

test("W goes where the view faces, D to the view's right", () => {
  for (const y of YAWS) {
    const [x, z] = moveFromView(y, 1, 0);
    assert.ok(near([x, 0, z], frontOf(y), 1e-12));
    const [sx, sz] = moveFromView(y, 0, 1);
    assert.ok(near([sx, 0, sz], rightOf(y), 1e-12));
    const cam = cameraBasis([0, 0, 0], frontOf(y));
    assert.ok(Math.abs(dot(cam.right, [sx, 0, sz]) - 1) < 1e-9, "D is the screen's right");
  }
});

interface Physics { boxDistance(p: Vec3Like, b: { c: Vec3Like; h: Vec3Like; yaw: number }): { d: number; n: Vec3 } }
const physics = hasPoc ? await poc<Physics>("src/physics/character.js") : null;

test("physics boxes turn the same way (their local +z face is where frontOf(yaw) points)", { skip: physics ? false : `no proof of concept at ${POC}` }, () => {
  for (const y of YAWS) {
    const b = { c: [0, 0, 0] as Vec3, h: [0.2, 0.5, 1] as Vec3, yaw: y };
    // Just past the long (local z) end: outside by 0.1, with the normal along frontOf(yaw).
    const p = localToWorld(b.c, y, [0, 0, 1.1]);
    const { d, n } = physics!.boxDistance(p, b);
    assert.ok(Math.abs(d - 0.1) < 1e-9, `distance ${d}`);
    assert.ok(near(n, frontOf(y), 1e-9));
  }
});

test("NOCTURNES instance yaws come in turned the right way", () => {
  // NOCTURNES (scene.js): world = [lx c - lz s, lx s + lz c] -> its front is [-sin, cos].
  for (const y of YAWS) {
    const noct = [-Math.sin(y), 0, Math.cos(y)];
    assert.ok(near(frontOf(fromNocturnesYaw(y)), noct, 1e-12));
  }
});

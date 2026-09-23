// Wedge geometry and character behavior regressions.

import { test } from "node:test";
import assert from "node:assert/strict";
import { frontOf, localToWorld } from "@keel-engine/core";
import type { Vec3, Vec3Like } from "@keel-engine/core";
import { createCharacter } from "../src/character.ts";
import { boxDistance, slopeOf, solidDistance, wedgeDistance } from "../src/solids.ts";
import type { Box, Wedge } from "../src/solids.ts";
import { FLOOR, K, YAWS16, dot, idle, run } from "./helpers.ts";

// ---------------------------------------------------------------- wedges (ramps)

// A ramp of slope `deg` on the floor: foot at +z (local), rising toward -z; `len` long, `w` wide.
const rampOf = (deg: number, { len = 6, w = 3, yaw = 0, at = [0, 0, 0] as Vec3Like, lo = 0 } = {}): Wedge & { c: Vec3; h: Vec3; yaw: number } => {
  const hy = (len * Math.tan((deg * Math.PI) / 180)) / 2 / (1 - lo);
  return { kind: "wedge", c: [at[0], at[1] + hy, at[2]], h: [w / 2, hy, len / 2], yaw, lo, mat: 1 };
};

test("wedgeDistance is exact: |grad| = 1, the normal is the gradient, and p - n d lies on the surface", () => {
  for (const yaw of YAWS16) {
    for (const lo of [0, 0.3]) {
      const w: Wedge = { kind: "wedge", c: [0.3, 0.5, -0.2], h: [0.8, 0.6, 1.4], yaw, lo };
      for (let k = 0; k < 60; k += 1) {
        const p: Vec3 = [Math.sin(k * 1.7) * 2.5, 0.5 + Math.cos(k * 2.3) * 1.6, Math.sin(k * 0.9 + 1) * 2.5];
        const { d, n } = wedgeDistance(p, w);
        assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-9, "unit normal");
        const e = 1e-6;
        const g = ([0, 1, 2] as const).map((i) => { const a: Vec3 = [...p]; const c: Vec3 = [...p]; a[i] += e; c[i] -= e; return (wedgeDistance(a, w).d - wedgeDistance(c, w).d) / (2 * e); }) as Vec3;
        if (Math.abs(d) > 0.02) assert.ok(dot(g, n) > 0.999, `gradient ${String(g)} vs normal ${String(n)}`);
        if (d > 0.02) assert.ok(Math.abs(wedgeDistance([p[0] - n[0] * d, p[1] - n[1] * d, p[2] - n[2] * d], w).d) < 1e-9, "projects onto the surface");
      }
    }
  }
});

test("wedges turn like everything else: the slope looks along frontOf(yaw), the high face behind", () => {
  for (const yaw of YAWS16) {
    const w = rampOf(30, { yaw });
    assert.ok(Math.abs(slopeOf(w) - Math.PI / 6) < 1e-12);
    const above = localToWorld(w.c, yaw, [0, 3, 0]);
    const { n } = wedgeDistance(above, w);
    const f = frontOf(yaw);
    assert.ok(Math.abs(n[1] - Math.cos(Math.PI / 6)) < 1e-9, `slope normal ${String(n)}`);
    assert.ok(Math.abs(n[0] * f[0] + n[2] * f[2] - Math.sin(Math.PI / 6)) < 1e-9, "leans toward the foot (front)");
    const behind = localToWorld(w.c, yaw, [0, 0, -w.h[2] - 1]);
    const back = wedgeDistance(behind, w);
    assert.ok(Math.abs(back.d - 1) < 1e-9 && dot(back.n, f) < -0.999, "the high face looks back");
    assert.equal(solidDistance(above, w).d, wedgeDistance(above, w).d);
    assert.equal(solidDistance(above, { ...w, kind: undefined }).d, boxDistance(above, w).d);
  }
});

test("wedge: stood on at 30° and 40°, the body stays put -- no creeping down", () => {
  for (const deg of [20, 30, 40]) {
    for (const yaw of [0, 1.1, -2.3]) {
      const w = rampOf(deg, { yaw });
      const spot = localToWorld(w.c, yaw, [0.2, w.h[1] + 0.3, 0]);
      const body = createCharacter({ boxes: [FLOOR], wedges: [w], waterY: -10, spawn: spot });
      run(body, 120, idle);
      assert.equal(body.mode, "ground", `${deg}° stands`);
      const p0 = [...body.pos];
      run(body, 240, idle);
      assert.ok(Math.hypot(body.pos[0] - p0[0]!, body.pos[1] - p0[1]!, body.pos[2] - p0[2]!) < 1e-3, `${deg}° yaw ${yaw}: crept ${String(body.pos)} from ${String(p0)}`);
      assert.equal(body.mode, "ground");
      assert.ok(body.slope && Math.abs(body.slope[1] - Math.cos((deg * Math.PI) / 180)) < 1e-6, "knows its slope");
    }
  }
});

test("wedge: it runs up a 35° ramp onto the block at its top, and down again, on the ground all the way", () => {
  for (const yaw of YAWS16.slice(0, 8)) {
    const w = rampOf(35, { yaw, len: 5 });
    const top = 2 * w.h[1];
    const block: Box = { c: localToWorld([0, 0, 0], yaw, [0, top / 2, -w.h[2] - 3]), h: [1.5, top / 2, 3], yaw };
    const f = frontOf(yaw);
    const body = createCharacter({ boxes: [FLOOR, block], wedges: [w], waterY: -10, spawn: localToWorld([0, 0, 0], yaw, [0, 0.05, w.h[2] + 3]) });
    let air = 0;
    run(body, 240, (b) => { if (b.mode === "air") air += 1; const far = dot([b.pos[0] - block.c[0], 0, b.pos[2] - block.c[2]], f) < 0; return { move: far ? [0, 0] : [-f[0], -f[2]], jump: false, hold: false }; });
    assert.ok(Math.abs(body.pos[1] - top) < 0.03, `yaw ${yaw.toFixed(2)}: on top at ${body.pos[1]} (top ${top})`);
    assert.ok(air < 6, `stayed on its feet going up (${air} air steps)`);
    // Turn round and run down: glued to the slope, not bounding off it.
    air = 0;
    run(body, 150, (b) => { if (b.mode === "air") air += 1; return { move: [f[0], f[2]], jump: false, hold: false }; });
    assert.ok(body.pos[1] < 0.05, "back on the floor");
    assert.ok(air < 12, `down the ramp on its feet (${air} air steps)`);
  }
});

test("wedge: steeper than slopeMax, it slides and can't stand or climb", () => {
  const w = rampOf(55, { len: 3 });
  const body = createCharacter({ boxes: [FLOOR], wedges: [w], waterY: -10, spawn: [0, w.h[1] * 1.4 + 0.4, 0] });
  let ground = 0;
  run(body, 240, (b) => { if (b.mode === "ground" && b.pos[1] > 0.1) ground += 1; return idle; });
  assert.equal(ground, 0, "never stood on the steep slope");
  assert.ok(body.pos[1] < 0.02 && body.pos[2] > w.h[2], `slid off its foot: ${String(body.pos)}`);
  // Run at it: it can't get up.
  const b2 = createCharacter({ boxes: [FLOOR], wedges: [w], waterY: -10, spawn: [0, 0.05, 6] });
  let high = 0;
  run(b2, 240, (b) => { high = Math.max(high, b.pos[1]); return { move: [0, -1], jump: false, hold: false }; });
  assert.ok(high < w.h[1], `stayed low: ${high}`);
});

test("wedge: a jump from a ramp, and landing on one", () => {
  const w = rampOf(25, { len: 8 });
  const body = createCharacter({ boxes: [FLOOR], wedges: [w], waterY: -10, spawn: [0, w.h[1] + 0.2, 0] });
  run(body, 60, idle);
  const ev = run(body, 120, (_b, i) => ({ move: [0, 0], jump: i === 0, hold: true }));
  assert.ok(ev.includes("jumped") && ev.includes("landed"));
  assert.equal(body.mode, "ground");
  const drop = createCharacter({ boxes: [FLOOR], wedges: [w], waterY: -10, spawn: [0.5, 5, 1] });
  const ev2 = run(drop, 200, idle);
  assert.ok(ev2.includes("landed"));
  assert.equal(drop.mode, "ground");
  assert.ok(wedgeDistance([drop.pos[0], drop.pos[1] + K.radius, drop.pos[2]], w).d > K.radius - 0.01, "on it, not in it");
});

test("wedge: its high face stops a run at 16 yaws, and it is no wall to run on", () => {
  for (const yaw of YAWS16) {
    const w = rampOf(40, { yaw, len: 3, w: 6 });
    const f = frontOf(yaw);
    const body = createCharacter({ boxes: [FLOOR], wedges: [w], waterY: -10, spawn: localToWorld([0, 0, 0], yaw, [0, 0.05, -w.h[2] - 4]) });
    const ev = run(body, 150, { move: [f[0], f[2]], jump: false, hold: false });
    const local = dot([body.pos[0] - w.c[0], 0, body.pos[2] - w.c[2]], f);
    assert.ok(local < -w.h[2] - K.radius + 0.02, `yaw ${yaw.toFixed(2)}: stopped behind its high face (${local})`);
    assert.ok(!ev.includes("wallStart"));
  }
});

test("wedge: a boxes-only world ignores the wedge code (the golden runs pin it); a fall never passes maxFall", () => {
  const body = createCharacter({ boxes: [{ c: [0, -1, 0], h: [3, 0.02, 3] }], waterY: -300, spawn: [0, 80, 0] });
  let fastest = 0;
  run(body, 600, (b) => { fastest = Math.max(fastest, -b.vel[1]); return idle; });
  assert.ok(fastest <= K.maxFall + 1e-9, `fell at ${fastest}`);
  assert.equal(body.mode, "ground", "and landed on a 4 cm slab from 81 m");
});

test("wedge: one given among the boxes (kind: \"wedge\") is a wedge, as the renderer reads it", () => {
  const w = rampOf(30);
  const spot: Vec3 = [0, w.c[1] + w.h[1] + 0.3, 0];
  const a = createCharacter({ boxes: [FLOOR], wedges: [w], waterY: -10, spawn: spot });
  const b = createCharacter({ boxes: [FLOOR, w], waterY: -10, spawn: spot });
  run(a, 120, idle);
  run(b, 120, idle);
  assert.deepEqual(a.pos, b.pos);
  assert.ok(b.slope, "stood on it as a slope, not a box");
});

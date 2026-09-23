// The port of the proof of concept's tests/physics.test.mjs: the body's
// moves, one rule at a time -- the jump (arc, coyote time, the buffer, hold vs
// tap), the wall-run (start, hold, end, kick; one face, never round a wall's
// end; a floor's edge is not a wall), the rail (catch, grind, cap, exit), the
// water (skim when fast, sink when slow), the respawn, collision at every yaw
// with no tunnelling, and determinism. Wedges and ramps have their own test file.

import { test } from "node:test";
import assert from "node:assert/strict";
import { frontOf, localToWorld, rightOf } from "@keel-engine/core";
import type { Vec3 } from "@keel-engine/core";
import { createCharacter } from "../src/character.ts";
import type { BodyEvent, BodyInput, Character, CharacterSpec } from "../src/character.ts";
import { boxDistance, nearestOnRail } from "../src/solids.ts";
import type { Box } from "../src/solids.ts";
import { DT, FLOOR, K, YAWS16, dot, has, idle, run, settle, slab } from "./helpers.ts";

// ---------------------------------------------------------------- the jump

test("jump: a held jump from standing rises v²/2g, and comes back down where it left", () => {
  const body = createCharacter({ boxes: [FLOOR], waterY: -10, spawn: [0, 0.05, 0] });
  settle(body);
  assert.equal(body.mode, "ground");
  const y0 = body.pos[1];
  let peak = y0;
  const ev = run(body, 120, (b, i) => { peak = Math.max(peak, b.pos[1]); return { move: [0, 0], jump: i === 0, hold: true }; });
  const want = (K.jump * K.jump) / (2 * K.gravity); // (1.54 m)
  assert.ok(Math.abs(peak - y0 - want) < want * 0.03, `peak ${peak - y0} vs ${want}`);
  assert.ok(ev.includes("jumped") && ev.includes("landed"));
  assert.equal(body.mode, "ground");
  assert.ok(Math.hypot(body.pos[0], body.pos[2]) < 1e-9, "straight up, straight down");
});

test("jump: a running jump carries run speed x flight time (2v/g)", () => {
  const body = createCharacter({ boxes: [FLOOR], waterY: -10, spawn: [0, 0.05, -20] });
  run(body, 240, { move: [0, 1], jump: false, hold: true }); // (up to speed)
  assert.ok(Math.abs(body.vel[2] - K.runSpeed) < 1e-6, `run speed ${body.vel[2]}`);
  const z0 = body.pos[2];
  let zLand: number | null = null;
  run(body, 120, (b, i) => { if (zLand === null && i > 0 && has(b, "landed")) zLand = b.pos[2]; return { move: [0, 1], jump: i === 0, hold: true }; });
  const want = K.runSpeed * ((2 * K.jump) / K.gravity); // (6.8 m)
  assert.ok(zLand !== null, "it landed");
  assert.ok(Math.abs(zLand - z0 - want) < want * 0.04, `range ${zLand - z0} vs ${want}`);
});

test("jump: tapped (let go at once) rises well under half a held jump", () => {
  const peakOf = (hold: boolean): number => {
    const body = createCharacter({ boxes: [FLOOR], waterY: -10, spawn: [0, 0.05, 0] });
    settle(body);
    const y0 = body.pos[1];
    let peak = y0;
    run(body, 120, (b, i) => { peak = Math.max(peak, b.pos[1]); return { move: [0, 0], jump: i === 0, hold: hold || i === 0 }; });
    return peak - y0;
  };
  const held = peakOf(true);
  const tap = peakOf(false);
  // (Let go and the rise has 2.4 g against it: v²/(2 * 2.4 g).)
  const want = (K.jump * K.jump) / (2 * K.gravity * 2.4);
  assert.ok(Math.abs(tap - want) < want * 0.08, `tap ${tap} vs ${want}`); // (the first step rises uncut)
  assert.ok(tap < held * 0.45, `tap ${tap} held ${held}`);
});

test("jump: coyote time -- a jump just after running off an edge still counts; a late one doesn't", () => {
  const tryAfter = (late: number): boolean => {
    const body = createCharacter({ boxes: [slab(-3, 3, -10, 0, 2)], waterY: -20, spawn: [0, 2.05, -6] });
    let leftAt: number | null = null;
    let jumped = false;
    run(body, 200, (b, i) => {
      if (leftAt === null && b.mode === "air" && i > 10) leftAt = i;
      const press = leftAt !== null && i === leftAt + late;
      if (has(b, "jumped")) jumped = true;
      return { move: [0, 1], jump: press, hold: true };
    });
    return jumped;
  };
  assert.equal(tryAfter(Math.floor((K.coyote * 0.6) / DT)), true, "within coyote time");
  assert.equal(tryAfter(Math.ceil((K.coyote * 1.6) / DT)), false, "past coyote time");
});

test("jump: the buffer -- pressed just before landing, it jumps on landing; pressed early, it doesn't", () => {
  const tryBefore = (early: number): boolean => {
    // Drop from 3 m; find the landing step first, then press `early` seconds before it.
    const probe = createCharacter({ boxes: [FLOOR], waterY: -10, spawn: [0, 3, 0] });
    let land = 0;
    for (let i = 0; i < 200 && !land; i += 1) { probe.step(DT, idle); if (probe.mode === "ground") land = i; }
    const body = createCharacter({ boxes: [FLOOR], waterY: -10, spawn: [0, 3, 0] });
    const press = land - Math.round(early / DT);
    const ev = run(body, land + 30, (_b, i) => ({ move: [0, 0], jump: i === press, hold: true }));
    return ev.includes("jumped");
  };
  assert.equal(tryBefore(K.buffer * 0.6), true, "inside the buffer");
  assert.equal(tryBefore(K.buffer * 1.8), false, "before the buffer");
});

// ---------------------------------------------------------------- the wall

// A wall along z at x = 1 (face toward -x at x = 0.75), running from z = 0 to z0 + len.
const wallAt = (len = 30, top = 8, z0 = 0): Box => ({ c: [1, top / 2 - 1, z0 + len / 2], h: [0.25, top / 2 + 1, len / 2], mat: 0 });
function onTheWall({ len = 30, top = 8 } = {}): { body: Character; ev: BodyEvent["type"][] } {
  const body = createCharacter({ boxes: [FLOOR, wallAt(len, top)], waterY: -10, spawn: [0.1, 0.05, -12] });
  // Up to speed along the wall, then a jump beside it.
  const ev = run(body, 150, (_b, i) => ({ move: [0, 1], jump: i === 140, hold: true }));
  return { body, ev };
}

test("wall: fast and alongside, a jump starts a wall-run on the wall's face", () => {
  const { body, ev } = onTheWall();
  let started = ev.includes("wallStart");
  for (let i = 0; i < 30 && !started; i += 1) { body.step(DT, { move: [0.3, 1], jump: false, hold: true }); started = has(body, "wallStart"); }
  assert.ok(started, "wallStart");
  assert.equal(body.mode, "wall");
  assert.ok(Math.abs(body.wall![0] + 1) < 1e-9, `normal points off the face: ${String(body.wall)}`);
});

test("wall: it holds -- light gravity, speed kept along the face -- then lets go after wallTime", () => {
  const { body } = onTheWall();
  for (let i = 0; i < 30 && body.mode !== "wall"; i += 1) body.step(DT, { move: [0.3, 1], jump: false, hold: true });
  assert.equal(body.mode, "wall");
  const y0 = body.pos[1];
  let t = 0;
  let ended = false;
  let minSpeed = Infinity;
  while (t < K.wallTime + 0.2 && !ended) {
    body.step(DT, { move: [0, 1], jump: false, hold: true });
    t += DT;
    if (has(body, "wallEnd")) ended = true;
    else { minSpeed = Math.min(minSpeed, body.vel[2]); assert.ok(body.pos[0] <= 0.75 - K.radius + 1e-6 && body.pos[0] > 0.75 - K.radius - 0.42, `within reach of the face: ${body.pos[0]}`); }
  }
  assert.ok(ended, "wallEnd");
  assert.ok(Math.abs(t - K.wallTime) < 0.05, `ended after ${t}s`);
  assert.ok(minSpeed >= K.wallMin, `kept its speed: ${minSpeed}`);
  assert.ok(body.pos[1] > y0 - 1, "hardly fell (light gravity)");
});

test("wall: the kick throws it off the face and up", () => {
  const { body } = onTheWall();
  for (let i = 0; i < 30 && body.mode !== "wall"; i += 1) body.step(DT, { move: [0.3, 1], jump: false, hold: true });
  run(body, 20, { move: [0, 1], jump: false, hold: true });
  body.step(DT, { move: [0, 1], jump: true, hold: true });
  assert.ok(has(body, "wallJump"));
  assert.equal(body.mode, "air");
  assert.ok(body.vel[0] < -K.wallKick * 0.85, `off the face: ${body.vel[0]}`); // (less the air steering of the same step)
  assert.ok(Math.abs(body.vel[1] - (K.wallUp - K.gravity * DT)) < 0.5, `up: ${body.vel[1]}`);
});

test("wall: it stays on one face and never wraps round a thin wall's end", () => {
  // A short wall: the run carries it past the end, where the nearest point turns the corner.
  const body = createCharacter({ boxes: [FLOOR, wallAt(6, 8, -3)], waterY: -10, spawn: [0.1, 0.05, -12] });
  let face: Vec3 | null = null;
  let ended = false;
  run(body, 400, (b, i) => {
    if (b.mode === "wall") {
      face ??= [...b.wall!];
      assert.ok(dot(b.wall!, face) > 0.9, `stayed on one face: ${String(b.wall)}`);
      assert.ok(b.pos[0] < 0.75, "never round to the far side");
    }
    if (b.pos[2] < 3 + K.radius) assert.ok(b.pos[0] < 0.75, `never behind the wall: ${String(b.pos)}`);
    if (face) assert.ok(b.vel[2] > 0, "never turned round the end");
    if (has(b, "wallEnd")) ended = true;
    return { move: b.mode === "ground" ? [0, 1] : [0.3, 1], jump: i === 128, hold: true };
  });
  assert.ok(face, "it ran the wall");
  assert.ok(ended, "and let go at its end");
});

test("wall: a floor's edge is a step, not a wall", () => {
  // Jump alongside a raised pad whose top is below the head: no wall-run.
  const pad: Box = { c: [1.5, 0, 0], h: [0.75, 0.6, 30] }; // (top at 0.6)
  const body = createCharacter({ boxes: [FLOOR, pad], waterY: -10, spawn: [0.2, 0.05, -25] });
  const ev = run(body, 300, (_b, i) => ({ move: [0.2, 1], jump: i % 90 === 60, hold: true }));
  assert.ok(!ev.includes("wallStart"), "no wall-run on a pad's side");
  // Nor brushing into it, low, in the air (the middle sphere leans on the pad's side).
  const b2 = createCharacter({ boxes: [FLOOR, { c: [1.5, 0, 0], h: [0.75, 1.0, 30] }], waterY: -10, spawn: [0.2, 0.05, -25] });
  const ev2 = run(b2, 400, (b, i) => ({ move: b.mode === "ground" ? [0, 1] : [0.5, 1], jump: i % 100 === 80, hold: true }));
  assert.ok(!ev2.includes("wallStart"), "no wall-run on a waist-high block");
});

// ---------------------------------------------------------------- the rail

const RAIL: Vec3[] = [[0, 1, 0], [0, 1, 10], [0, 1.5, 20]];
function onTheRail(rail: Vec3[] = RAIL, speed = 6): { body: Character; ev: BodyEvent["type"][] } {
  const body = createCharacter({ boxes: [], rails: [rail], waterY: -20, spawn: [0, 1.8, 1] });
  body.vel = [0, 0, speed];
  const ev = run(body, 40, { move: [0, 1], jump: false, hold: true });
  return { body, ev };
}

test("rail: falling onto it catches it, pushed on along it", () => {
  const { body, ev } = onTheRail();
  assert.ok(ev.includes("railStart"));
  assert.equal(body.mode, "grind");
  assert.ok(body.vel[2] > 6, `pushed on: ${body.vel[2]}`);
  const at = nearestOnRail([body.pos[0], body.pos[1] - K.railLift, body.pos[2]], RAIL)!;
  assert.ok(at.d < 0.2, `rides the rail: ${at.d}`);
});

test("rail: it settles toward cruise, a steep drop never flings it past railMax, and it leaves at the end", () => {
  const drop: Vec3[] = [[0, 30, 0], [0, 20, 10], [0, 10, 20], [0, 0, 30]]; // (45° down)
  const body = createCharacter({ boxes: [], rails: [drop], waterY: -50, spawn: [0, 30.8, 0.5] });
  body.vel = [0, 0, 8];
  let top = 0;
  let caught = false;
  let ended = false;
  let lastVy = 0;
  for (let i = 0; i < 600 && !ended; i += 1) {
    body.step(DT, { move: [0, 1], jump: false, hold: true });
    if (body.mode === "grind") { caught = true; top = Math.max(top, Math.hypot(...body.vel)); }
    if (has(body, "railEnd")) { ended = true; lastVy = body.vel[1]; }
  }
  assert.ok(caught, "caught");
  assert.ok(top <= K.railMax + 1e-9, `capped: ${top}`);
  assert.ok(top > K.railCruise, `the drop sped it past cruise: ${top}`);
  assert.ok(ended, "railEnd");
  assert.equal(body.mode, "air");
  assert.ok(lastVy > -K.railMax, "left with a lift");
});

test("rail: a flat rail settles on cruise, and a jump leaves it", () => {
  const long: Vec3[] = [[0, 1, 0], [0, 1, 100]];
  const { body } = onTheRail(long, 4);
  run(body, 240, { move: [0, 1], jump: false, hold: true });
  assert.equal(body.mode, "grind");
  assert.ok(Math.abs(body.vel[2] - K.railCruise) < 0.3, `cruise ${body.vel[2]}`);
  body.step(DT, { move: [0, 1], jump: true, hold: true });
  assert.ok(has(body, "jumped"));
  assert.equal(body.mode, "air");
  assert.ok(body.vel[1] > K.jump * 0.9);
});

test("rail: the grinding event carries the way along it; landed carries the fall's speed (typed payloads)", () => {
  const { body } = onTheRail();
  body.step(DT, { move: [0, 1], jump: false, hold: true });
  const g = body.events.find((e) => e.type === "grinding");
  assert.ok(g && g.type === "grinding");
  assert.ok(g.tan[2] > 0.9 && Math.abs(Math.hypot(...g.tan) - 1) < 1e-12);
  const drop = createCharacter({ boxes: [FLOOR], waterY: -10, spawn: [0, 2, 0] });
  let speed = 0;
  for (let i = 0; i < 120; i += 1) { drop.step(DT, idle); for (const e of drop.events) if (e.type === "landed") speed = e.speed; }
  assert.ok(speed > 5, `landed at ${speed}`);
});

// ---------------------------------------------------------------- the water

function offThePad(speed: number): { body: Character; ev: BodyEvent["type"][] } {
  const body = createCharacter({ boxes: [slab(-3, 3, -12, 0, 0.4)], waterY: 0, spawn: [0, 0.5, -10] });
  const ev = run(body, 600, { move: [0, speed], jump: false, hold: false });
  return { body, ev };
}

test("water: fast (above skimMin) it skims; slow it sinks", () => {
  const fast = offThePad(1);
  assert.ok(fast.ev.includes("skimStart"), "skims");
  assert.ok(K.runSpeed >= K.skimMin);
  const slow = offThePad((K.skimMin * 0.8) / K.runSpeed);
  assert.ok(!slow.ev.includes("skimStart"), "no skim");
  assert.ok(slow.ev.includes("splashIn"), "sinks");
});

test("water: a skim holds the surface, drags, and sinks once slow; a jump leaves it", () => {
  const body = createCharacter({ boxes: [slab(-3, 3, -40, 0, 0.4)], waterY: 0, spawn: [0, 0.5, -38] });
  run(body, 600, (b) => ({ move: [0, b.mode === "skim" ? 0 : 1], jump: false, hold: false }));
  // (It skimmed, let go of the stick, dragged below skimMin * 0.9 and sank -- or is sinking.)
  const b2 = createCharacter({ boxes: [slab(-3, 3, -40, 0, 0.4)], waterY: 0, spawn: [0, 0.5, -38] });
  let skimmed = false;
  let sank = false;
  for (let i = 0; i < 1200 && !sank; i += 1) {
    b2.step(DT, { move: [0, b2.mode === "skim" ? 0 : 1], jump: false, hold: false });
    if (b2.mode === "skim") { skimmed = true; assert.equal(b2.pos[1], 0, "on the surface"); }
    if (b2.mode === "sink") { sank = true; assert.ok(Math.hypot(b2.vel[0], b2.vel[2]) < K.skimMin, "slowed first"); }
  }
  assert.ok(skimmed && sank);
  const b3 = createCharacter({ boxes: [slab(-3, 3, -40, 0, 0.4)], waterY: 0, spawn: [0, 0.5, -38] });
  for (let i = 0; i < 600 && b3.mode !== "skim"; i += 1) b3.step(DT, { move: [0, 1], jump: false, hold: false });
  b3.step(DT, { move: [0, 1], jump: true, hold: true });
  assert.equal(b3.mode, "air");
  assert.ok(b3.vel[1] > 0);
});

test("respawn: sunk, it comes back at the last place it stood after `respawn` seconds", () => {
  const b = createCharacter({ boxes: [slab(-3, 3, -12, 0, 0.4)], waterY: 0, spawn: [0, 0.5, -10] });
  let sunkAt: number | null = null;
  let back: number | null = null;
  let checkpoint: Vec3 | null = null;
  for (let i = 0; i < 1000 && back === null; i += 1) {
    b.step(DT, { move: [0, sunkAt === null ? 0.5 : 0], jump: false, hold: false });
    if (sunkAt === null && b.mode === "sink") { sunkAt = i; checkpoint = [...b.checkpoint]; }
    if (has(b, "respawn")) back = i;
  }
  assert.ok(back !== null && sunkAt !== null && checkpoint !== null, "respawned");
  assert.ok(Math.abs((back - sunkAt) * DT - K.respawn) < 0.02, `after ${(back - sunkAt) * DT}s`);
  assert.deepEqual(b.pos, checkpoint);
  assert.ok(checkpoint[2] < K.radius && checkpoint[2] > -3, `the pad's end, where it last stood: ${String(checkpoint)}`);
  assert.equal(b.mode, "air");
});

// ---------------------------------------------------------------- collision

test("collision: a thin wall at 16 yaws stops a run at full speed -- no tunnelling at 120 Hz", () => {
  for (const yaw of YAWS16) {
    for (const thick of [0.02, 0.1, 0.5]) {
      // The wall's face looks along frontOf(yaw); run at it from its front.
      const wall: Box = { c: [0, 1, 0], h: [3, 3, thick / 2], yaw };
      const f = frontOf(yaw);
      const start = localToWorld([0, 0, 0], yaw, [0.3, 0.05, 4]);
      const body = createCharacter({ boxes: [FLOOR, wall], waterY: -10, spawn: start });
      body.vel = [-f[0] * K.runSpeed, 0, -f[2] * K.runSpeed];
      run(body, 120, { move: [-f[0], -f[2]], jump: false, hold: false });
      const side = dot([body.pos[0], 0, body.pos[2]], f);
      assert.ok(side > thick / 2 + K.radius - 0.02, `yaw ${yaw.toFixed(2)} thick ${thick}: still in front (${side})`);
      // And flung at it at the rail's cap and a wall-kick's speed, in the air.
      const b2 = createCharacter({ boxes: [FLOOR, wall], waterY: -10, spawn: localToWorld([0, 0, 0], yaw, [0, 1, 3]) });
      b2.vel = [-f[0] * (K.railMax + K.wallKick), 0, -f[2] * (K.railMax + K.wallKick)];
      run(b2, 60, idle);
      assert.ok(dot([b2.pos[0], 0, b2.pos[2]], f) > 0, `yaw ${yaw.toFixed(2)} thick ${thick}: the fling didn't pass through`);
    }
  }
});

test("collision: a slide along a turned wall keeps the along-speed (only the into-part is taken)", () => {
  for (const yaw of YAWS16) {
    const wall: Box = { c: [0, 1, 0], h: [20, 3, 0.25], yaw };
    const f = frontOf(yaw);
    const r = rightOf(yaw);
    const body = createCharacter({ boxes: [FLOOR, wall], waterY: -10, spawn: localToWorld([0, 0, 0], yaw, [-5, 0.05, 0.25 + K.radius + 0.01]) });
    body.vel = [(r[0] - f[0]) * 5, 0, (r[2] - f[2]) * 5];
    body.step(DT, { move: [r[0] - f[0], r[2] - f[2]], jump: false, hold: false });
    run(body, 30, { move: [r[0], r[2]], jump: false, hold: false });
    assert.ok(dot(body.vel, r) > 4, `yaw ${yaw.toFixed(2)}: slides on along the wall ${dot(body.vel, r)}`);
    assert.ok(dot(body.pos, f) > 0.25, "and stays in front of it");
  }
});

test("collision: a fall from 12 m onto a thin slab lands on it", () => {
  const body = createCharacter({ boxes: [{ c: [0, 0, 0], h: [3, 0.05, 3] }], waterY: -30, spawn: [0, 12, 0] });
  run(body, 240, idle);
  assert.equal(body.mode, "ground");
  assert.ok(Math.abs(body.pos[1] - 0.05) < 0.02, `on top: ${body.pos[1]}`);
});

test("boxDistance at 16 yaws matches brute force: the distance, and the normal points away", () => {
  const b = { c: [0.4, 0.2, -0.3], h: [0.7, 0.4, 1.3] } as const;
  for (const yaw of YAWS16) {
    const box: Box = { ...b, yaw };
    for (let k = 0; k < 40; k += 1) {
      const p: Vec3 = [Math.sin(k * 1.7) * 2.5, Math.cos(k * 2.3) * 1.5, Math.sin(k * 0.9 + 1) * 2.5];
      const { d, n } = boxDistance(p, box);
      const e = 1e-5;
      const g = ([0, 1, 2] as const).map((i) => { const a: Vec3 = [...p]; const c: Vec3 = [...p]; a[i] += e; c[i] -= e; return (boxDistance(a, box).d - boxDistance(c, box).d) / (2 * e); }) as Vec3;
      assert.ok(Math.abs(Math.hypot(...n) - 1) < 1e-9);
      if (d > 0.01) assert.ok(dot(g, n) > 0.999, `gradient agrees outside ${String(g)} ${String(n)}`);
    }
  }
});

// ---------------------------------------------------------------- determinism

test("determinism: the same inputs make the same run, to the bit, every time", () => {
  const world: CharacterSpec = { boxes: [FLOOR, wallAt(), { c: [-3, 0.5, 5], h: [1, 0.5, 1], yaw: 0.7 }], rails: [RAIL.map((p): Vec3 => [p[0] - 5, p[1], p[2]])], waterY: -10, spawn: [0, 0.05, -12] as Vec3 };
  const go = (): unknown[] => {
    const body = createCharacter(world);
    const out: unknown[] = [];
    for (let i = 0; i < 1200; i += 1) {
      body.step(DT, { move: [Math.sin(i * 0.01), Math.cos(i * 0.013)], jump: i % 70 === 0, hold: i % 70 < 30 });
      out.push(...body.pos, ...body.vel, body.mode);
    }
    return out;
  };
  assert.deepEqual(go(), go());
});

// ---------------------------------------------------------------- the frame (from tests/frame.test.mjs)

test("physics boxes turn the same way as the frame (their local +z face is where frontOf(yaw) points)", () => {
  const YAWS = Array.from({ length: 24 }, (_, i) => -Math.PI + (i + 0.5) * (Math.PI / 12));
  for (const y of YAWS) {
    const b: Box = { c: [0, 0, 0], h: [0.2, 0.5, 1], yaw: y };
    // Just past the long (local z) end: outside by 0.1, with the normal along frontOf(yaw).
    const p = localToWorld(b.c, y, [0, 0, 1.1]);
    const { d, n } = boxDistance(p, b);
    assert.ok(Math.abs(d - 0.1) < 1e-9, `distance ${d}`);
    const f = frontOf(y);
    assert.ok(n.every((v, i) => Math.abs(v - f[i]!) < 1e-9));
  }
});

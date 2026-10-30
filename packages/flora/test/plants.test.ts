// The plant catalogue builds real, bounded, deterministic geometry; the spring
// field pushes, rings out and comes to rest; vines hug what they climb.
import { test } from "node:test";
import assert from "node:assert/strict";
import { PLANTS, PLANT_KINDS, crawl, createFloraMotion, createPlantField, plantGeometry } from "../src/index.ts";

const array = (kind: string, name: string, seed = 1, detail = 1): Float32Array => {
  const a = plantGeometry(kind, { seed, detail }).getAttribute(name);
  return a!.array as Float32Array;
};

test("every kind is one unit tall, rooted, finite, with bend weights in range", () => {
  assert.ok(PLANT_KINDS.length >= 90);
  for (const kind of PLANT_KINDS) {
    const p = array(kind, "position"), part = array(kind, "aPart");
    assert.ok(p.every(Number.isFinite), `${kind} is finite`);
    let high = -Infinity, low = Infinity;
    for (let i = 1; i < p.length; i += 3) { high = Math.max(high, p[i]!); low = Math.min(low, p[i]!); }
    if (PLANTS[kind]!.hang) assert.ok(Math.abs(low + 1) < 1e-3 && high <= 0.05, `${kind} hangs one long, got ${String(low)}`);
    else assert.ok(Math.abs(high - 1) < 1e-3, `${kind} stands one tall, got ${String(high)}`);
    for (let i = 1; i < part.length; i += 4) assert.ok(part[i]! >= 0 && part[i]! <= 1, `${kind} bend`);
  }
});

test("a kind is the same from the same seed, differs by seed, and thins with detail", () => {
  assert.deepEqual(array("hydrangea", "position", 4), array("hydrangea", "position", 4));
  assert.notDeepEqual(array("hydrangea", "position", 4), array("hydrangea", "position", 5));
  assert.ok(array("boxwood", "position", 1, 0.3).length < array("boxwood", "position", 1, 1).length * 0.6);
  assert.throws(() => plantGeometry("triffid"), /Unknown plant/u);
});

test("a body bends what is under it, and the bend lets go and rests", () => {
  const m = createFloraMotion({ bounds: [-8, -8, 8, 8], cells: 32 });
  m.setBodies([{ x: 0, z: 0, radius: 2 }]);
  for (let i = 0; i < 90; i += 1) m.step(1 / 60);
  const [bx, , press] = m.at(1.2, 0);
  assert.ok(bx > 0.15, `pushed out along +x, got ${String(bx)}`);
  assert.ok(press > 0.3, "trodden flat");
  m.setBodies([]);
  for (let i = 0; i < 60 * 30; i += 1) m.step(1 / 60);
  const [rx, rz, rp] = m.at(1.2, 0);
  assert.ok(Math.abs(rx) < 1e-3 && Math.abs(rz) < 1e-3 && rp < 0.01, "rests");
});

test("a blow rings out past where it landed, and stays stable", () => {
  const m = createFloraMotion({ bounds: [-8, -8, 8, 8], cells: 64 });
  m.impact({ x: 0, z: 0, radius: 1.5, strength: 2 });
  assert.equal(m.at(5, 0)[0], 0);
  let reached = 0, biggest = 0;
  for (let i = 0; i < 240; i += 1) {
    m.step(1 / 60);
    reached = Math.max(reached, Math.abs(m.at(5, 0)[0]));
    biggest = Math.max(biggest, Math.abs(m.at(0.8, 0)[0]));
  }
  assert.ok(reached > 1e-4, "the ring arrives");
  assert.ok(biggest < 6, `stable, got ${String(biggest)}`);
  assert.ok(reached < biggest);
});

test("the same pushes make the same field", () => {
  const run = (): number[] => {
    const m = createFloraMotion({ bounds: [0, 0, 10, 10], cells: 24 });
    m.setBodies([{ x: 3, z: 4, radius: 1.5, vx: 1 }]);
    for (let i = 0; i < 40; i += 1) m.step(1 / 60);
    m.impact({ x: 6, z: 6, radius: 2, direction: 1 });
    for (let i = 0; i < 40; i += 1) m.step(1 / 60);
    return [...m.at(4, 4), ...m.at(6, 6)];
  };
  assert.deepEqual(run(), run());
});

test("a vine stays on what it climbs and goes the way it is sent", () => {
  const ball = (x: number, y: number, z: number): number => Math.hypot(x, y - 1, z) - 1;
  const path = crawl(ball, { start: [1, 0.9, 0], steps: 30, step: 0.06, gap: 0.02, seed: 3 });
  for (const p of path) assert.ok(Math.abs(ball(p[0], p[1], p[2]) - 0.02) < 0.01);
  assert.ok(path[path.length - 1]![1] > path[0]![1] + 0.3, "climbs");
  assert.deepEqual(path, crawl(ball, { start: [1, 0.9, 0], steps: 30, step: 0.06, gap: 0.02, seed: 3 }));
});

test("plants gain detail as the eye comes near and drop away past their reach", () => {
  const motion = createFloraMotion({ bounds: [-30, -30, 30, 30], cells: 8 });
  const places = Array.from({ length: 40 }, (_, i) => ({ kind: "boxwood", x: (i % 8) * 6 - 21, y: 0, z: Math.floor(i / 8) * 6 - 12, size: 1, tint: "#4f7f3a" }));
  const field = createPlantField({ motion, variants: 1 }, places);
  field.setView(0, 300, 0);
  assert.deepEqual(field.levels, [0, 0, 0], "past every reach nothing is drawn");
  assert.equal(field.triangles, 0);
  field.setView(0, 60, 0);
  const far = field.triangles;
  assert.ok(far > 0 && field.levels[2] === 40);
  field.setView(0, 1.5, 0);
  assert.ok(field.levels[0] > 0 && field.levels[0] < 40, "only what is close is rich");
  const near = field.triangles;
  assert.ok(near > far, `coming close costs more, ${String(far)} to ${String(near)}`);
  const rich = field.levels[0];
  field.setView(0.1, 1.5, 0);
  assert.equal(field.levels[0], rich, "a small move changes nothing");
  field.dispose();
});

test("a plant's near shape is far richer than its far one", () => {
  const leaves = (detail: number): number => plantGeometry("boxwood", { detail }).index!.count;
  assert.ok(leaves(1.8) > leaves(0.22) * 5);
});

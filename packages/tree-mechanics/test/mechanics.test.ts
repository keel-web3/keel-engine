// A trunk with a limb and a twig: limbs stay joined however they move, wind
// pushes downwind and the limbs sway at their own frequencies, weight and
// snow sag what is horizontal, dead wood breaks in a storm and comes down to
// the ground, and the climbable wood carries less the further out it goes.
import { test } from "node:test";
import assert from "node:assert/strict";
import { createTreeMechanics } from "../src/index.ts";
import type { TreePose, TreeShape } from "../src/index.ts";

interface Piece { readonly parent: number; readonly order: number; readonly to: readonly [number, number, number]; readonly r: number; readonly dead?: number }

/** A trunk of four 1 m internodes, a 2 m limb east from its top, and a twig on the limb. */
const PIECES: readonly Piece[] = [
  { parent: -1, order: 0, to: [0, 1, 0], r: 0.2 },
  { parent: 0, order: 0, to: [0, 2, 0], r: 0.17 },
  { parent: 1, order: 0, to: [0, 3, 0], r: 0.14 },
  { parent: 2, order: 0, to: [0, 4, 0], r: 0.11 },
  { parent: 3, order: 1, to: [1, 4.2, 0], r: 0.05 },
  { parent: 4, order: 1, to: [2, 4.3, 0], r: 0.035 },
  { parent: 5, order: 2, to: [2.4, 4.6, 0.3], r: 0.015 },
];

function tree(pieces: readonly Piece[] = PIECES): { shape: TreeShape; pose: TreePose } {
  const n = pieces.length;
  const f = (fill: (p: Piece, i: number) => number): Float32Array => Float32Array.from(pieces, fill);
  const end = (i: number, axis: number): number => (i < 0 ? 0 : pieces[i]!.to[axis]!);
  const shape: TreeShape = { count: n, parent: Int32Array.from(pieces, (p) => p.parent), order: Uint8Array.from(pieces, (p) => p.order) };
  const pose: TreePose = {
    grow: new Float32Array(n).fill(1), radius: f((p) => p.r), dead: f((p) => p.dead ?? 0), fall: new Float32Array(n), rot: new Float32Array(n),
    x: f((p) => p.to[0]), y: f((p) => p.to[1]), z: f((p) => p.to[2]),
    baseX: f((p) => end(p.parent, 0)), baseY: f((p) => end(p.parent, 1)), baseZ: f((p) => end(p.parent, 2)),
  };
  return { shape, pose };
}

const TWIG = 6;

test("still air leaves the tree at rest, and moved limbs stay joined", () => {
  const { shape, pose } = tree();
  const m = createTreeMechanics(shape, { breaks: false });
  let moved = m.update(pose, { elapsed: 0, dt: 1 / 60, wind: 0 });
  for (let k = 0; k < shape.count; k += 1) assert.ok(Math.abs(moved.x[k]! - pose.x[k]!) < 1e-6 && Math.abs(moved.y[k]! - pose.y[k]!) < 1e-6);
  for (let i = 1; i < 240; i += 1) moved = m.update(pose, { elapsed: i / 60, dt: 1 / 60, wind: 0.9, dir: Math.PI / 2, snow: 0.5, loads: [{ node: 5, mass: 8 }] });
  for (let k = 1; k < shape.count; k += 1) {
    const parent = shape.parent[k]!;
    assert.ok(Math.hypot(moved.baseX[k]! - moved.x[parent]!, moved.baseY[k]! - moved.y[parent]!, moved.baseZ[k]! - moved.z[parent]!) < 1e-5, `joint ${String(k)}`);
    const rest = Math.hypot(pose.x[k]! - pose.baseX[k]!, pose.y[k]! - pose.baseY[k]!, pose.z[k]! - pose.baseZ[k]!);
    const now = Math.hypot(moved.x[k]! - moved.baseX[k]!, moved.y[k]! - moved.baseY[k]!, moved.z[k]! - moved.baseZ[k]!);
    assert.ok(Math.abs(rest - now) < 1e-4, `internode ${String(k)} keeps its length`);
  }
  assert.equal(m.update(pose, { elapsed: 5, dt: 1 / 60, wind: 0 }), moved, "the same frame gives back the same object");
});

test("wind pushes the crown downwind, thin wood sways quicker than the trunk, and it is deterministic", () => {
  const run = (): number[] => {
    const { shape, pose } = tree();
    const m = createTreeMechanics(shape, { breaks: false });
    const tops: number[] = [];
    for (let i = 0; i < 600; i += 1) tops.push(m.update(pose, { elapsed: i / 60, dt: 1 / 60, wind: 0.6, dir: Math.PI / 2 }).z[3]!);
    return tops;
  };
  const a = run();
  assert.deepEqual(a, run());
  const mean = a.slice(120).reduce((sum, z) => sum + z, 0) / (a.length - 120);
  assert.ok(mean > 1e-4, "the trunk's top leans toward +z, the way the wind blows");
  const { shape } = tree();
  const m = createTreeMechanics(shape);
  m.update(tree().pose, { elapsed: 0, dt: 1 / 60, wind: 0 });
  assert.equal(m.limbOf(3), 0);
  assert.equal(m.limbOf(5), 4);
  assert.ok(m.frequency(TWIG) > m.frequency(4) && m.frequency(4) > m.frequency(0), "twig > limb > trunk");
});

test("weight and snow sag the limb, and it springs back when the weight goes", () => {
  const { shape, pose } = tree();
  const m = createTreeMechanics(shape, { breaks: false });
  let y = pose.y[5]!;
  for (let i = 0; i < 300; i += 1) y = m.update(pose, { elapsed: i / 60, dt: 1 / 60, wind: 0, loads: [{ node: 5, mass: 20 }] }).y[5]!;
  const loaded = pose.y[5]! - y;
  assert.ok(loaded > 0.01, `a 20 kg animal at the limb's end sags it (${loaded.toFixed(4)} m)`);
  for (let i = 300; i < 900; i += 1) y = m.update(pose, { elapsed: i / 60, dt: 1 / 60, wind: 0 }).y[5]!;
  assert.ok(Math.abs(pose.y[5]! - y) < loaded * 0.05, "and it settles back once the animal leaves");
  const snowy = createTreeMechanics(shape, { breaks: false });
  for (let i = 0; i < 300; i += 1) y = snowy.update(pose, { elapsed: i / 60, dt: 1 / 60, wind: 0, snow: 1, foliage: 0 }).y[5]!;
  assert.ok(pose.y[5]! - y > 1e-4, "snow on the limb weighs it down");
});

test("dead wood gives more than sound wood, and what it takes it keeps", () => {
  const sag = (dead: number): { held: number; after: number } => {
    const { shape, pose } = tree(PIECES.map((piece, i) => (i >= 4 ? { ...piece, dead } : piece)));
    const m = createTreeMechanics(shape, { breaks: false, creep: 0.2 });
    let y = pose.y[5]!;
    for (let i = 0; i < 1800; i += 1) y = m.update(pose, { elapsed: i / 60, dt: 1 / 60, wind: 0, loads: [{ node: 5, mass: 1 }] }).y[5]!;
    const held = pose.y[5]! - y;
    for (let i = 1800; i < 3600; i += 1) y = m.update(pose, { elapsed: i / 60, dt: 1 / 60, wind: 0 }).y[5]!;
    return { held, after: pose.y[5]! - y };
  };
  const sound = sag(0), dead = sag(1);
  assert.ok(dead.held > sound.held * 1.3, `dead wood sags further (${dead.held.toFixed(3)} vs ${sound.held.toFixed(3)})`);
  assert.ok(dead.after > dead.held * 0.5, `and stays down once the weight goes (${dead.after.toFixed(3)} of ${dead.held.toFixed(3)})`);
  assert.ok(sound.after < dead.after * 0.8, `where sound wood lifts back (${sound.after.toFixed(3)})`);
});

test("a storm breaks dead wood, never the trunk, and the piece comes to rest on the ground", () => {
  const pieces = PIECES.map((p, i) => (i === 5 || i === TWIG ? { ...p, dead: 1 } : p));
  const { shape, pose } = tree(pieces);
  const m = createTreeMechanics(shape, { ground: 0, wood: { strength: 3e5 }, breaks: { cooldown: 0.5 } });
  let moved = m.update(pose, { elapsed: 0, dt: 1 / 60, wind: 0 });
  for (let i = 1; i < 60 * 20; i += 1) moved = m.update(pose, { elapsed: i / 60, dt: 1 / 60, wind: 1.6, dir: 0 });
  assert.ok(m.breaks.length > 0, "something broke");
  for (const b of m.breaks) assert.ok(shape.order[b.node]! > 0, "never the trunk");
  const first = m.breaks[0]!;
  assert.ok(first.node === 5 || first.node === TWIG, `the dead wood went first (${String(first.node)})`);
  for (let k = first.node; k < shape.count; k += 1) {
    assert.equal(moved.fall[k], 1, `${String(k)} has landed`);
    assert.ok(Math.min(moved.y[k]!, moved.baseY[k]!) - pose.radius[k]! > -1e-3, `${String(k)} rests on the ground, not in it`);
  }
  assert.ok(!m.capsules(0).some((c) => c.node >= first.node), "broken wood is no longer climbable");
  m.heal();
  assert.equal(m.breaks.length, 0);
});

test("capsules follow the moved wood, carry less further out, and paths run from the ground", () => {
  const { shape, pose } = tree();
  const m = createTreeMechanics(shape);
  m.update(pose, { elapsed: 0, dt: 1 / 60, wind: 0 });
  const caps = m.capsules(0.03);
  assert.deepEqual(caps.map((c) => c.node), [0, 1, 2, 3, 4, 5]);
  const carry = (node: number): number => caps.find((c) => c.node === node)!.carry;
  assert.ok(carry(5) < carry(4) && carry(4) < carry(1), "outer wood bears less");
  assert.equal(m.carry(TWIG) < carry(5), true);
  const path = m.woodPath(5);
  assert.deepEqual(path[0]!.p, [0, 0, 0]);
  assert.equal(path.length, 7);
  assert.deepEqual(path.at(-1)!.p, [pose.x[5]!, pose.y[5]!, pose.z[5]!]);
});

test("a struck storm breaks what a live one would, the pieces lie on the ground, and they rot when their time is up", () => {
  const pieces = PIECES.map((p, i) => (i === 5 || i === TWIG ? { ...p, dead: 1 } : p));
  const { shape, pose } = tree(pieces);
  const m = createTreeMechanics(shape, { ground: 0, wood: { strength: 3e5 }, breaks: { lieFor: 100, rotFor: 50 } });
  assert.deepEqual(m.storm(pose, { elapsed: 10, dt: 0, wind: 0.2 }), [], "a breeze breaks nothing");
  const struck = m.storm(pose, { elapsed: 20, dt: 0, wind: 1.6, dir: 0 });
  assert.ok(struck.length > 0 && struck.every((b) => b.at === 20 && shape.order[b.node]! > 0), "the storm took limbs, never the trunk");
  assert.deepEqual(m.breaks, struck);
  const first = struck[0]!.node;
  let moved = m.update(pose, { elapsed: 1000, dt: 1 / 60, wind: 0 });
  for (let k = first; k < shape.count; k += 1) {
    assert.equal(moved.fall[k], 1, `${String(k)} lies on the ground, long after the storm`);
    assert.ok(Math.min(moved.y[k]!, moved.baseY[k]!) - pose.radius[k]! > -1e-3, `${String(k)} rests on it, not in it`);
  }
  assert.ok(moved.rot[first]! > 0.99, "and it has rotted away");
  const again = createTreeMechanics(shape, { ground: 0, wood: { strength: 3e5 }, breaks: { lieFor: 100, rotFor: 50 } });
  assert.deepEqual(again.storm(pose, { elapsed: 20, dt: 0, wind: 1.6, dir: 0 }).map((b) => b.node), struck.map((b) => b.node), "it is deterministic");
  moved = again.update(pose, { elapsed: 60, dt: 1 / 60, wind: 0 });
  assert.equal(moved.rot[first], 0, "still lying, not yet rotting");
});

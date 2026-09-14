// restore() is exact: a world restored from a snapshot draws the same frames
// as the world that went on -- poses mid-stride and mid-crossfade (the
// animators' saved state), a camera blend in progress, the fov kick, frame
// shots, a held clip -- into the same world or a fresh one, through JSON and
// through the codec's bytes (keel/world/snapshot).
// (The proof of concept's world restarted its animators and dropped the blend:
// test/poc-equality.test.ts "difference 2".)

import { test } from "node:test";
import assert from "node:assert/strict";
import type { Frame, World, WorldOptions } from "../src/index.ts";
import { makeWorld } from "./fixtures.ts";

// (The palette's key counts rebuilds -- a restore rebuilds it -- and names no colour.)
const pixels = (w: World): Frame => { const f = JSON.parse(JSON.stringify(w.frame())) as Frame; return { ...f, palette: { ...f.palette, key: "" } }; };

/** Snapshot at `at` s (after `prepare`), then compare the straight run with restored runs, frame by frame. */
function exact(label: string, opts: WorldOptions, at: number, prepare: (w: World) => void = () => {}): void {
  const w = makeWorld(opts);
  prepare(w);
  w.simulate(at);
  const snap = w.snapshot();
  const straight: Frame[] = [];
  for (let i = 0; i < 12; i += 1) { w.simulate(1 / 30); straight.push(pixels(w)); }
  const after = JSON.stringify(w.snapshot());
  // Into the same world ...
  w.restore(snap);
  assert.equal(JSON.stringify(w.snapshot()), JSON.stringify(snap), `${label}: restore, then snapshot, is the snapshot`);
  for (let i = 0; i < 12; i += 1) { w.simulate(1 / 30); assert.deepEqual(pixels(w), straight[i], `${label}: frame ${i} after restore`); }
  assert.equal(JSON.stringify(w.snapshot()), after, `${label}: and the same state`);
  // ... and into a fresh one, through JSON.
  const fresh = makeWorld(opts);
  prepare(fresh);
  fresh.restore(JSON.stringify(snap));
  for (let i = 0; i < 12; i += 1) { fresh.simulate(1 / 30); assert.deepEqual(pixels(fresh), straight[i], `${label}: fresh frame ${i}`); }
}

test("restore is pixel-exact mid-run: poses, particles, the orbit camera", () => {
  for (const at of [0.5, 1.37, 3, 6.25]) exact(`at ${at}`, {}, at);
});

test("restore is pixel-exact mid-blend, mid-fov-kick and on a frame shot", () => {
  exact("mid-blend", {}, 2.6, (w) => { w.system("switch", { order: 650, step: (world) => { if (world.steps === 300) world.set("scene", "system.camera.mode", "chase"); } }); });
  exact("fov kick", { camera: { fovKick: 0.3, kickSpeeds: [1, 4] } }, 2.2);
  exact("frame shots", { config: { locks: "scene/system.camera.mode=frame;scene/system.camera.cycle=0.7" } }, 2.05);
  exact("small target", { width: 32, height: 32 }, 1.5);
});

test("restore is pixel-exact with a clip held and a body frozen", () => {
  exact("held", {}, 1.2, (w) => {
    w.system("sit", { order: 650, step: (world) => {
      const a = world.entities.get("animal-1")!;
      if (world.steps === 100) { a.hold = { clip: "sit" }; a.frozen = true; }
    } });
  });
});

test("a v1 snapshot (the proof of concept's) is refused, not half-restored", () => {
  const w = makeWorld();
  const snap = { ...w.snapshot(), v: 1 } as unknown as Parameters<World["restore"]>[0];
  assert.throws(() => w.restore(snap), /v2/);
});

// ---------------------------------------------------------------- through the codec

/** As exact(), but the snapshot goes through the codec's bytes (keel/world/snapshot) both times. */
function exactBytes(label: string, opts: WorldOptions, at: number, prepare: (w: World) => void = () => {}): void {
  const w = makeWorld(opts);
  prepare(w);
  w.simulate(at);
  // (Some particles in the air, so the bytes carry them.)
  for (let k = 0; k < 4; k += 1) w.particles.emit("dust", [k, 0.3, -k], { count: 6 });
  const snap = w.snapshot();
  const bytes = w.snapshotBytes();
  const json = JSON.stringify(snap);
  assert.ok(bytes.length < json.length / 2, `${label}: ${bytes.length} bytes vs ${json.length} of JSON`);
  const straight: Frame[] = [];
  for (let i = 0; i < 12; i += 1) { w.simulate(1 / 30); straight.push(pixels(w)); }
  const after = JSON.stringify(w.snapshot());
  // Into the same world ...
  w.restoreBytes(bytes);
  assert.equal(JSON.stringify(w.snapshot()), json, `${label}: restore from bytes, then snapshot, is the snapshot`);
  assert.deepEqual(w.snapshotBytes(), bytes, `${label}: and the same bytes`);
  for (let i = 0; i < 12; i += 1) { w.simulate(1 / 30); assert.deepEqual(pixels(w), straight[i], `${label}: frame ${i} after restore`); }
  assert.equal(JSON.stringify(w.snapshot()), after, `${label}: and the same state`);
  // ... and into a fresh one.
  const fresh = makeWorld(opts);
  prepare(fresh);
  fresh.restoreBytes(bytes);
  for (let i = 0; i < 12; i += 1) { fresh.simulate(1 / 30); assert.deepEqual(pixels(fresh), straight[i], `${label}: fresh frame ${i}`); }
  assert.equal(JSON.stringify(fresh.snapshot()), after, `${label}: fresh, the same state`);
}

test("restore from codec bytes is pixel-exact, into the same world and a fresh one, in under half the JSON", () => {
  for (const at of [0.5, 3]) exactBytes(`at ${at}`, {}, at);
  exactBytes("mid-blend", {}, 2.6, (w) => { w.system("switch", { order: 650, step: (world) => { if (world.steps === 300) world.set("scene", "system.camera.mode", "chase"); } }); });
  exactBytes("fov kick", { camera: { fovKick: 0.3, kickSpeeds: [1, 4] } }, 2.2);
});

test("restoreBytes refuses bytes that aren't a world snapshot, saying so, and leaves the world as it was", () => {
  const w = makeWorld();
  w.simulate(0.4);
  const before = JSON.stringify(w.snapshot());
  const bytes = w.snapshotBytes();
  assert.throws(() => w.restoreBytes(new Uint8Array([0xb1, 1, 2, 3, 4, 0])), (e: unknown) => e instanceof TypeError && /aren't a world snapshot \(keel\/world\/snapshot\)/.test(e.message));
  assert.throws(() => w.restoreBytes(bytes.subarray(0, bytes.length >> 1)), /aren't a world snapshot/);
  assert.equal(JSON.stringify(w.snapshot()), before);
});
